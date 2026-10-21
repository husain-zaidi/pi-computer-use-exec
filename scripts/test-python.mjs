import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.PI_CUA_PYTHON || resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'], { cwd: root, stdio: 'inherit' });
if (result.error) { console.error(result.error); process.exit(1); }
process.exit(result.status ?? 1);
