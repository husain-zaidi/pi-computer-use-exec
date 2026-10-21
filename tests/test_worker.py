import base64
import importlib.util
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import patch, Mock
import sys

from PIL import Image

spec = importlib.util.spec_from_file_location("worker", Path(__file__).parents[1] / "python" / "worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.runtime = worker.Runtime()

    def tearDown(self):
        self.runtime.close()

    def test_persistent_state(self):
        self.runtime.execute("answer = 41")
        result = self.runtime.execute("answer += 1; log(answer)")
        self.assertIsNone(result["error"])
        self.assertEqual(result["content"][0]["text"], "42\n")

    def test_errors_preserve_partial_state_and_output(self):
        result = self.runtime.execute("value = 'saved'; print(value); raise ValueError('expected')")
        self.assertIn("ValueError: expected", result["error"])
        self.assertIn("saved", result["content"][0]["text"])
        self.assertIn("saved", self.runtime.execute("log(value)")["content"][0]["text"])

    def test_syntax_and_system_exit_are_reported(self):
        self.assertIn("SyntaxError", self.runtime.execute("x =") ["error"])
        self.assertIn("SystemExit", self.runtime.execute("raise SystemExit(1)")["error"])
        self.assertIsNone(self.runtime.execute("log('still alive')")["error"])

    def test_empty_and_oversized_code(self):
        for code in ("", " " * 65537):
            self.assertIn("ValueError", self.runtime.execute(code)["error"])

    def test_png_image(self):
        self.runtime.namespace["test_image"] = Image.new("RGB", (20, 10), "red")
        result = self.runtime.execute("display(test_image)")
        image = result["content"][0]
        self.assertEqual(image["mimeType"], "image/png")
        self.assertTrue(base64.b64decode(image["data"]).startswith(b"\x89PNG"))

    def test_invalid_and_excess_images(self):
        self.assertIn("TypeError", self.runtime.execute("display('not an image')")["error"])
        self.runtime.namespace["test_image"] = Image.new("RGB", (1, 1))
        self.assertIn("four images", self.runtime.execute("for _ in range(5): display(test_image)")["error"])

    def test_output_is_bounded_and_spilled(self):
        result = self.runtime.execute("print('x' * 60000)")
        text = "".join(item["text"] for item in result["content"])
        self.assertLess(len(text), 50000)
        self.assertIn("Output truncated", text)
        path = text.split("saved to ")[1].split(".]")[0]
        self.assertEqual(Path(path).read_text().strip(), "x" * 60000)
        Path(path).unlink()

    def test_line_limit(self):
        result = self.runtime.execute("print('x\\n' * 2001)")
        text = "".join(item["text"] for item in result["content"])
        self.assertIn("Output truncated", text)
        path = text.split("saved to ")[1].split(".]")[0]
        Path(path).unlink()

    def test_desktop_is_opt_in(self):
        self.assertNotIn("pyautogui", self.runtime.namespace)

    def test_failsafe_is_fatal_and_cannot_stay_disabled(self):
        class FailSafe(Exception):
            pass
        fake = SimpleNamespace(FAILSAFE=True, FailSafeException=FailSafe)
        self.runtime.pyautogui = fake
        self.runtime.namespace["pyautogui"] = fake
        self.assertTrue(self.runtime.execute("raise pyautogui.FailSafeException('corner')")["fatal"])
        self.assertIn("Do not disable", self.runtime.execute("pyautogui.FAILSAFE = False")["error"])
        self.assertTrue(fake.FAILSAFE)

    @unittest.skipUnless(sys.platform == 'win32', 'Windows native focus helper')
    def test_focus_refuses_ambiguous_windows(self):
        self.runtime.page = SimpleNamespace(bring_to_front=lambda: None, title=lambda: 'Test')
        fake_window = SimpleNamespace(title='Test - Chromium')
        self.runtime.pyautogui = SimpleNamespace(getWindowsWithTitle=lambda title: [fake_window, fake_window])
        with self.assertRaisesRegex(RuntimeError, 'ambiguous'):
            self.runtime.focus_browser()

    @unittest.skipUnless(sys.platform == 'win32', 'Windows native focus helper')
    def test_focus_checks_native_foreground(self):
        self.runtime.page = SimpleNamespace(bring_to_front=lambda: None, title=lambda: 'Test')
        window = SimpleNamespace(title='Test - Google Chrome for Testing', _hWnd=123, isMinimized=False, activate=Mock())
        self.runtime.pyautogui = SimpleNamespace(getWindowsWithTitle=lambda title: [window])
        with patch('ctypes.windll.user32.GetForegroundWindow', Mock(return_value=123)):
            self.assertTrue(self.runtime.focus_browser()['focused'])
            window.activate.assert_not_called()
        with patch('ctypes.windll.user32.GetForegroundWindow', Mock(return_value=456)):
            with self.assertRaisesRegex(RuntimeError, 'denied foreground'):
                self.runtime.focus_browser()


if __name__ == "__main__":
    unittest.main()
