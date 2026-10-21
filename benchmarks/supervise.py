"""Launch one pi CLI in a trial-owned process tree; leave no browser descendants.

Both benchmark variants use this identical wrapper. No extension code is changed.
"""
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from lifecycle import install_parent_guard, kill_windows_descendants

install_parent_guard()
process = subprocess.Popen(sys.argv[1:])
code = process.wait()
if sys.platform == "win32":
    kill_windows_descendants([process.pid])
raise SystemExit(code)
