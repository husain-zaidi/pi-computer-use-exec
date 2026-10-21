"""Real PyAutoGUI input + Playwright verification via the extension's worker.
Not an LLM latency measurement. Run alone (uses the physical keyboard).
"""
import http.server
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = dict(name="Ada Lovelace", email="ada@example.test", company="Analytical Engines", job="Research Engineer", notes="Please send the workshop agenda.", updates=True)
received = []
TITLE = 'Desktop smoke ' + uuid.uuid4().hex[:10]


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        html = (ROOT / "benchmarks/form.html").read_text(encoding="utf-8")
        html = html.replace('Workshop registration — computer-use benchmark', TITLE)
        self.wfile.write(html.encode("utf-8"))

    def do_POST(self):
        received.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": received[-1] == EXPECTED}).encode())


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
process = subprocess.Popen([sys.executable, "-u", str(ROOT / "python/worker.py"), "--desktop"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")


def execute(code, id):
    process.stdin.write(json.dumps({"operation": "execute", "id": id, "code": code}) + "\n")
    process.stdin.flush()
    reply = json.loads(process.stdout.readline())
    if reply.get("error"):
        raise RuntimeError(reply["error"])
    return reply


try:
    ready = json.loads(process.stdout.readline())
    assert ready.get("ready"), ready
    url = f"http://127.0.0.1:{server.server_port}/case/desktop-smoke"
    execute(f"start_browser({url!r}); log(page.locator('body').aria_snapshot()); assert pyautogui.FAILSAFE; image = pyautogui.screenshot(); assert image.size == tuple(pyautogui.size()); log('desktop capture coordinate check passed')", 1)
    # Ground the first editable control with Playwright, then exercise REAL keyboard input.
    # Only this dedicated browser is brought forward. No other desktop app is inspected.
    started = time.perf_counter()
    text = "Ada Lovelace\tada@example.test\tAnalytical Engines\tResearch Engineer\tPlease send the workshop agenda.\t"
    result = execute(f"log(focus_browser()); page.get_by_label('Full name', exact=True).click(); pyautogui.write({text!r}, interval=0.01); pyautogui.press('space'); pyautogui.press('tab'); pyautogui.press('enter'); page.get_by_role('status').filter(has_text='Registration complete').wait_for(state='visible', timeout=15000); log(page.get_by_role('status').inner_text())", 2)
    assert received == [EXPECTED], received
    output = ROOT / "benchmarks/results/desktop-smoke.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"success": True, "backend": "PyAutoGUI typing + Playwright setup/focus/verification", "llmDriven": False, "actionWallMs": (time.perf_counter() - started) * 1000, "received": received, "result": result}, indent=2))
    print(f"PASS: real desktop typing, checkbox, submission, screenshot coordinate check; {output}")
except BaseException as error:
    diagnostic = None
    if process.poll() is None:
        try:
            diagnostic = execute("log(page.locator('body').aria_snapshot()); log(page.evaluate('document.hasFocus()')); log([(w.title, w._hWnd) for w in pyautogui.getWindowsWithTitle(page.title())])", 99)
        except Exception:
            pass
    output = ROOT / "benchmarks/results/desktop-smoke.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"success": False, "llmDriven": False, "reason": str(error), "received": received, "diagnostic": diagnostic}, indent=2))
    raise
finally:
    if process.poll() is None:
        process.stdin.write(json.dumps({"operation": "close"}) + "\n")
        process.stdin.flush()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            if sys.platform == "win32":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
            else:
                process.kill()
    cleanup = subprocess.run([sys.executable, str(ROOT / "python/release_inputs.py")], capture_output=True, text=True)
    if cleanup.returncode:
        print("WARNING: input cleanup failed:", cleanup.stdout, cleanup.stderr)
    server.shutdown()
    server.server_close()
