#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

cd "$APP_DIR"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

# Runtime secrets: regenerated from CI-provided env vars (WS_AUTH_TOKEN,
# POSTGRES_PASSWORD, PUBLIC_ORIGIN, PAVOIS_DEV_TOKEN) on every deploy, so a
# VPS move or credential rotation needs no manual SSH step -- just a new
# GitHub secret value and a redeploy. Falls back to the *.example templates
# (created once, then left alone) for a manual/local run without those vars.
if [ -n "${WS_AUTH_TOKEN:-}" ] || [ -n "${POSTGRES_PASSWORD:-}" ]; then
  cp .env.example .env
  [ -n "${POSTGRES_PASSWORD:-}" ] && sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" .env
  [ -n "${PAVOIS_DEV_TOKEN:-}" ] && sed -i "s|^PAVOIS_DEV_TOKEN=.*|PAVOIS_DEV_TOKEN=${PAVOIS_DEV_TOKEN}|" .env

  cp vps/.env.example vps/.env
  [ -n "${WS_AUTH_TOKEN:-}" ] && sed -i "s|^WS_AUTH_TOKEN=.*|WS_AUTH_TOKEN=${WS_AUTH_TOKEN}|" vps/.env
  [ -n "${PUBLIC_ORIGIN:-}" ] && sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=${PUBLIC_ORIGIN}|" vps/.env
  echo "Regenerated .env and vps/.env from CI-provided secrets."
else
  if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp .env.example .env
    echo "Created .env from .env.example. Update it with your VPS values if needed."
  fi

  if [ ! -f "vps/.env" ] && [ -f "vps/.env.example" ]; then
    cp vps/.env.example vps/.env
    echo "Created vps/.env from vps/.env.example. Update secrets before first public rollout."
  fi
fi

DOCKER_CMD="docker"
if ! docker info >/dev/null 2>&1; then
  DOCKER_CMD="sudo docker"
fi

$DOCKER_CMD compose -f "$COMPOSE_FILE" pull --ignore-buildable || true
$DOCKER_CMD compose -f "$COMPOSE_FILE" up -d --build --remove-orphans
$DOCKER_CMD compose -f "$COMPOSE_FILE" ps
