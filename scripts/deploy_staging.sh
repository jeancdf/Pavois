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

# Existing files still listed the previous VPS IP; WS then closed
# with "Forbidden Origin" and the UI stayed HORS LIGNE.
STAGING_ORIGIN="http://51.91.98.159:8081"
if [ -f "vps/.env.staging" ] && ! grep -Fq "$STAGING_ORIGIN" vps/.env.staging; then
  if grep -q '^ALLOWED_ORIGINS=' vps/.env.staging; then
    sed -i "s|^ALLOWED_ORIGINS=\\(.*\\)|ALLOWED_ORIGINS=\\1,${STAGING_ORIGIN}|" \
      vps/.env.staging
  else
    echo "ALLOWED_ORIGINS=${STAGING_ORIGIN}" >> vps/.env.staging
  fi
  echo "[STAGING] ALLOWED_ORIGINS mis à jour : ${STAGING_ORIGIN}"
fi

DOCKER_CMD="docker"
if ! docker info >/dev/null 2>&1; then
  DOCKER_CMD="sudo docker"
fi

echo "[STAGING] Lancement du déploiement de l'environnement de Test / Staging..."
$DOCKER_CMD compose -f "$COMPOSE_FILE" up -d --build --remove-orphans
$DOCKER_CMD compose -f "$COMPOSE_FILE" ps

echo -e "\n\033[0;32m[STAGING OK] L'environnement de test est actif :\033[0m"
echo "  • Frontend Angular (Staging) : http://51.91.98.159:8081"
echo "  • WebSocket (via Nginx)      : ws://51.91.98.159:8081/ws"
echo "  • Serveur UDP (Staging)      : Ports 41234 et 41235 / UDP"
