#!/usr/bin/env bash
# Idempotent dependency setup for the P.A.V.O.I.S. dev environment.
# Installs Node.js 24 via nvm (Angular CLI 22 requires Node >= 22.22.3, and the
# default image ships an older bundled Node) and installs deps for both apps:
#   - vps            : NestJS backend (HTTP/WebSocket + UDP listener)
#   - frontend-angular: Angular 22 dashboard
set -euo pipefail

# Load nvm (present in the default Cloud Agent image).
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "ERROR: nvm not found at $NVM_DIR. Cannot provision Node.js 24." >&2
  exit 1
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

# Pin Node 24 and make it the default for future shells.
nvm install 24 >/dev/null
nvm alias default 24 >/dev/null
# The platform prepends its own bin dir to PATH, so select Node 24 explicitly.
export PATH="$(dirname "$(nvm which 24)"):$PATH"
echo "Using Node $(node -v) / npm $(npm -v)"

echo "Installing backend (vps) dependencies..."
( cd vps && npm ci )

echo "Installing frontend (frontend-angular) dependencies..."
( cd frontend-angular && npm ci )

echo "Install complete."
