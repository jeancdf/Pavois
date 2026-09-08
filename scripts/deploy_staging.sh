#!/usr/bin/env bash
# ==============================================================================
# SCRIPT DE DÉPLOIEMENT STAGING — PROJET PAVOIS (ENVIRONNEMENT ISOLÉ)
# ==============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
COMPOSE_FILE="docker-compose.staging.yml"

cd "$APP_DIR"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Compose file staging non trouvé: $COMPOSE_FILE" >&2
  exit 1
fi

if [ ! -f "vps/.env.staging" ] && [ -f "vps/.env.staging.example" ]; then
  cp vps/.env.staging.example vps/.env.staging
  echo "[STAGING] vps/.env.staging créé depuis le template."
fi

echo "[STAGING] Lancement du déploiement de l'environnement de Test / Staging..."
docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans
docker compose -f "$COMPOSE_FILE" ps

echo -e "\n\033[0;32m[STAGING OK] L'environnement de test est actif :\033[0m"
echo "  • Frontend Angular (Staging) : http://51.15.213.226:8081"
echo "  • Backend API / WS (Staging) : ws://51.15.213.226:3003"
echo "  • Serveur UDP (Staging)      : Port 41235 / UDP"
