#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

cd "$APP_DIR"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Update it with your VPS values if needed."
fi

if [ ! -f "vps/.env" ] && [ -f "vps/.env.example" ]; then
  cp vps/.env.example vps/.env
  echo "Created vps/.env from vps/.env.example. Update secrets before first public rollout."
fi

docker compose -f "$COMPOSE_FILE" pull --ignore-buildable || true
docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans
docker compose -f "$COMPOSE_FILE" ps
