#!/usr/bin/env bash
# Run on the Pi as the same account used for setup_pi.sh.
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 || ! $1 =~ ^pi-[a-z0-9-]+$ || $EUID -eq 0 ||
      ( $# -eq 2 && $2 != --prepare ) ]]; then
  echo "Usage (non-root): bash scripts/register_pi_runner.sh pi-<name> [--prepare]" >&2
  exit 1
fi
if [[ $(uname -m) != aarch64 ]]; then
  echo "This runner installation targets Raspberry Pi OS / Debian ARM64." >&2
  exit 1
fi
label=$1
runner_dir="$HOME/actions-runner-pavois"
mkdir -p "$runner_dir"
cd "$runner_dir"
if [[ -f .runner ]]; then
  echo "A runner is already registered in $runner_dir; leaving it unchanged."
  exit 0
fi

# Use GitHub's ARM64 release and verify its published SHA-256 before extraction.
python3 - <<'PY'
import hashlib
import json
import pathlib
import urllib.request

release = json.load(urllib.request.urlopen(
    'https://api.github.com/repos/actions/runner/releases/latest', timeout=30))
asset = next(a for a in release['assets']
             if a['name'].startswith('actions-runner-linux-arm64-')
             and a['name'].endswith('.tar.gz'))
digest = asset.get('digest', '')
if not digest.startswith('sha256:'):
    raise SystemExit('GitHub did not publish a SHA-256 for this release.')
target = pathlib.Path('runner.tar.gz')
if target.exists() and hashlib.file_digest(target.open('rb'), 'sha256').hexdigest() == digest.removeprefix('sha256:'):
    print('Reusing verified ' + asset['name'])
    raise SystemExit(0)
hasher = hashlib.sha256()
with urllib.request.urlopen(asset['browser_download_url'], timeout=60) as source, target.open('wb') as out:
    while chunk := source.read(1024 * 1024):
        hasher.update(chunk)
        out.write(chunk)
if hasher.hexdigest() != digest.removeprefix('sha256:'):
    raise SystemExit('Runner checksum mismatch; extraction refused.')
print('Verified ' + asset['name'])
PY
tar -xzf runner.tar.gz
sudo ./bin/installdependencies.sh

if [[ ${2:-} == --prepare ]]; then
  echo "Runner files and dependencies ready. Re-run without --prepare to register."
  exit 0
fi

if [[ -z ${PAVOIS_RUNNER_TOKEN:-} ]]; then
  read -r -s -p 'Temporary GitHub runner registration token: ' PAVOIS_RUNNER_TOKEN
  printf '\n'
fi
./config.sh --unattended --url https://github.com/jeancdf/Pavois \
  --token "$PAVOIS_RUNNER_TOKEN" --name "$label" --labels "$label" --work _work
unset PAVOIS_RUNNER_TOKEN
sudo ./svc.sh install "$(id -un)"
sudo ./svc.sh start
