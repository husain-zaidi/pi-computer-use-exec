import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const batch = process.argv[2] || 'measured';
const dir = join(root, 'benchmarks/results', batch);
const rows = JSON.parse(await readFile(join(dir, 'summary.json'), 'utf8'));
const median = values => { const v = [...values].sort((a, b) => a - b); const i = Math.floor(v.length / 2); return v.length % 2 ? v[i] : (v[i - 1] + v[i]) / 2; };
const stats = {};
for (const variant of ['code', 'baseline']) {
  const selected = rows.filter(row => row.variant === variant);
  stats[variant] = { runs: selected.length, successes: selected.filter(row => row.success).length };
  for (const field of ['elapsedMs', 'taskMs', 'submissionMs', 'toolMs', 'toolCalls', 'turns']) {
    const values = selected.map(row => row[field]).filter(value => value !== null && value !== undefined);
    stats[variant][field] = { median: median(values), min: Math.min(...values), max: Math.max(...values) };
  }
  stats[variant].tokens = { median: median(selected.map(row => row.usage.totalTokens)) };
}
stats.wallReductionPercent = 100 * (1 - stats.code.elapsedMs.median / stats.baseline.elapsedMs.median);
stats.wallSpeedup = stats.baseline.elapsedMs.median / stats.code.elapsedMs.median;
stats.taskReductionPercent = 100 * (1 - stats.code.taskMs.median / stats.baseline.taskMs.median);
const files = ['extensions/index.ts', 'src/client.ts', 'python/worker.py', 'python/lifecycle.py', 'python/cleanup.py', 'python/release_inputs.py', 'benchmarks/run.mjs', 'benchmarks/supervise.py', 'benchmarks/form.html', 'requirements.txt'];
const hashes = {};
for (const file of files) hashes[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex');
const invocation = JSON.parse(await readFile(join(dir, rows[0].id, 'invocation.json'), 'utf8'));
const python = process.env.PI_CUA_PYTHON || join(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const versions = spawnSync(python, ['-c', "import json,platform,importlib.metadata as m; print(json.dumps(dict(python=platform.python_version(),playwright=m.version('playwright'),pyautogui=m.version('PyAutoGUI'))))"], { encoding: 'utf8', timeout: 15000 });
if (versions.status !== 0) throw new Error(versions.stderr || 'Cannot determine Python versions');
const piPackage = JSON.parse(await readFile(resolve(dirname(invocation.args[0]), '../../package.json'), 'utf8'));
let chromiumVersion = 'Not automatically detected on this platform';
if (process.platform === 'win32') {
  const version = spawnSync('powershell.exe', ['-NoProfile', '-Command', '(Get-Item -LiteralPath $env:PI_CUA_METADATA_CHROME).VersionInfo.ProductVersion'], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, PI_CUA_METADATA_CHROME: invocation.settings.chrome },
  });
  if (version.status === 0) chromiumVersion = version.stdout.trim();
}
const metadata = {
  generatedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  architecture: process.arch, osRelease: os.release(),
  model: `${invocation.settings.provider}/${invocation.settings.model}`, thinking: invocation.settings.thinking, pi: piPackage.version,
  ...JSON.parse(versions.stdout), chromium: chromiumVersion,
  baseline: '@injaneity/pi-computer-use@0.5.1',
  baselineTarballSha256: createHash('sha256').update(await readFile(join(root, 'research/injaneity-pi-computer-use-0.5.1.tgz'))).digest('hex'),
  sourceSha256: hashes,
};
await writeFile(join(dir, 'statistics.json'), JSON.stringify(stats, null, 2));
await writeFile(join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2));
console.log(JSON.stringify(stats, null, 2));
