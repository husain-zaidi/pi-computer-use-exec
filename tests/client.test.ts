import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ComputerRuntime } from "../src/client.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = {
  python: process.env.PI_CUA_PYTHON || resolve(root, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python"),
  worker: resolve(root, "python/worker.py"), cwd: root,
};

test("persistent real Python worker and serialized concurrent calls", async () => {
  const runtime = new ComputerRuntime(options);
  try {
    const results = await Promise.all([
      runtime.execute("time.sleep(0.05); x = 1; log(x)", 15000),
      runtime.execute("x += 1; log(x)", 15000),
      runtime.execute("x += 1; log(x)", 15000),
    ]);
    assert.deepEqual(results.map(r => r.content[0]), [1, 2, 3].map(n => ({ type: "text", text: `${n}\n` })));
  } finally { await runtime.close(); }
});

test("ordinary exception preserves state", async () => {
  const runtime = new ComputerRuntime(options);
  try {
    assert.match((await runtime.execute("x = 9; raise ValueError('oops')", 15000)).error!, /oops/);
    assert.deepEqual((await runtime.execute("log(x)", 15000)).content[0], { type: "text", text: "9\n" });
  } finally { await runtime.close(); }
});

test("timeout terminates an infinite loop and refuses reuse", async () => {
  const runtime = new ComputerRuntime(options);
  try {
    await runtime.execute("log('ready')", 15000);
    await assert.rejects(runtime.execute("while True: pass", 250), /stopped|exited|exceeded/);
    await assert.rejects(runtime.execute("log(1)", 1000), /stopped/);
  } finally { await runtime.close(); }
});

test("active cancellation stops the worker", async () => {
  const runtime = new ComputerRuntime(options);
  const controller = new AbortController();
  try {
    await runtime.execute("log('ready')", 15000);
    const run = runtime.execute("time.sleep(60)", 10000, controller.signal);
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(run, /stopped|exited|cancelled/);
  } finally { await runtime.close(); }
});

test("pre-aborted queued request does not execute", async () => {
  const runtime = new ComputerRuntime(options);
  try {
    const first = runtime.execute("x = 1; time.sleep(0.1)", 15000);
    const cancelled = runtime.execute("x = 99", 10000, AbortSignal.abort());
    await assert.rejects(cancelled);
    await first;
    assert.deepEqual((await runtime.execute("log(x)", 10000)).content[0], { type: "text", text: "1\n" });
  } finally { await runtime.close(); }
});

test("missing Python fails promptly", async () => {
  const runtime = new ComputerRuntime({ ...options, python: "pi-cua-python-does-not-exist" });
  try { await assert.rejects(runtime.execute("log(1)", 10000), /ENOENT|exited/); }
  finally { await runtime.close(); }
});

test("Windows cleanup kills descendants after abrupt worker exit", { skip: process.platform !== "win32" }, async () => {
  const runtime = new ComputerRuntime(options);
  try {
    const reply = await runtime.execute("import subprocess, sys; descendant = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']); log(descendant.pid)", 15000);
    assert.equal(reply.error, null);
    const first = reply.content[0];
    assert.equal(first.type, "text");
    const pid = Number(first.type === "text" ? first.text.trim() : "");
    process.kill(pid, 0);
    await assert.rejects(runtime.execute("import os; os._exit(7)", 10000), /exited|stopped/);
    await runtime.close();
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.throws(() => process.kill(pid, 0));
  } finally { await runtime.close(); }
});

test("Playwright browser, DOM actions, image output, state reuse", async () => {
  const runtime = new ComputerRuntime(options);
  try {
    const html = `<label>Name<input id=n></label><button onclick="document.body.dataset.done=document.querySelector('#n').value">Save</button>`;
    const first = await runtime.execute(`start_browser(); page.set_content(${JSON.stringify(html)}); log(page.locator('body').aria_snapshot())`, 30000);
    assert.equal(first.error, null);
    const second = await runtime.execute("page.get_by_label('Name').fill('Ada'); page.get_by_role('button', name='Save').click(); assert page.locator('body').get_attribute('data-done') == 'Ada'; display(page.screenshot()); log('verified')", 15000);
    assert.equal(second.error, null);
    assert.equal(second.content[0].type, "image");
  } finally { await runtime.close(); }
});
