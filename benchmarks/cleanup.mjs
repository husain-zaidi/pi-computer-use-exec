// Explicit cleanup for Windows Chromium launches that reparent during de-elevation.
// Only browser roots whose command lines contain an exact URL from a COMPLETED
// benchmark invocation are eligible. Never enumerate/control unrelated UI.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = join(root, 'benchmarks/results');
const urls = new Set();
async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (entry.name === 'invocation.json') {
      try {
        await readFile(join(dir, 'summary.json')); // Don't touch an active trial.
        const { prompt } = JSON.parse(await readFile(file, 'utf8'));
        const url = prompt.match(/http:\/\/127\.0\.0\.1:\d+\/case\/(?:code|baseline)-[\w-]+/)?.[0];
        if (url) urls.add(url);
      } catch { /* Not a completed benchmark invocation. */ }
    }
  }
}
if (process.platform !== 'win32') { console.log('Windows-specific benchmark cleanup; no action taken.'); process.exit(0); }
await visit(results);
const query = 'Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "chrome.exe" -and $_.CommandLine -match "pi-chrome-cdp" -and $_.CommandLine -notmatch "--type=" } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress';
const response = spawnSync('powershell.exe', ['-NoProfile', '-Command', query], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
if (response.status !== 0) throw new Error(response.stderr || 'Could not query owned benchmark browsers.');
const parsed = JSON.parse(response.stdout.trim() || '[]');
const processes = Array.isArray(parsed) ? parsed : [parsed];
const cleanup = [];
for (const candidate of processes) {
  const url = [...urls].find(url => candidate.CommandLine?.includes(url));
  if (!url) continue;
  const killed = spawnSync('taskkill', ['/PID', String(candidate.ProcessId), '/T', '/F'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  cleanup.push({ pid: candidate.ProcessId, url, code: killed.status, output: killed.stdout.trim(), error: killed.stderr.trim() });
}
await writeFile(join(results, 'cleanup.json'), JSON.stringify(cleanup, null, 2));
console.log(`Cleaned ${cleanup.length} completed benchmark browser trees; see benchmarks/results/cleanup.json`);
if (cleanup.some(item => item.code !== 0)) process.exitCode = 1;
