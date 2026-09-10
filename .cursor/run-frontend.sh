#!/usr/bin/env bash
# Starts the Angular 22 dashboard dev server on port 4200 (development config).
# It auto-authenticates in dev and connects to the backend WebSocket at
# ws://localhost:3002 (see src/environments/environment.ts).
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
export PATH="$(dirname "$(nvm which 24)"):$PATH"

cd "$(dirname "$0")/../frontend-angular"

exec npm start -- --host 0.0.0.0 --port 4200
