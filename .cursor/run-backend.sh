#!/usr/bin/env bash
# Starts the NestJS backend (VPS server): HTTP + WebSocket on PORT (3002) and a
# UDP detection listener on UDP_PORT (41234). Dev defaults match the Angular
# frontend's expectations (ws://localhost:3002 with token "dev-pavois-token").
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
export PATH="$(dirname "$(nvm which 24)"):$PATH"

cd "$(dirname "$0")/../vps"

# Dev defaults; override via the environment if needed.
export PORT="${PORT:-3002}"
export UDP_PORT="${UDP_PORT:-41234}"
export WS_AUTH_TOKEN="${WS_AUTH_TOKEN:-dev-pavois-token}"

exec npm run start
