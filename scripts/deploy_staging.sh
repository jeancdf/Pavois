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

# Secrets d'exécution : régénérés depuis les variables fournies par la CI
# (WS_AUTH_TOKEN, POSTGRES_PASSWORD, PUBLIC_ORIGIN) à chaque déploiement --
# un changement de VPS ne demande plus aucune action manuelle sur la
# machine, juste une nouvelle valeur de secret GitHub et un redéploiement.
# Repli sur les templates *.example (créés une fois, puis laissés tels
# quels) pour un lancement manuel/local sans ces variables.
if [ -n "${WS_AUTH_TOKEN:-}" ] || [ -n "${POSTGRES_PASSWORD:-}" ]; then
  cp vps/.env.staging.example vps/.env.staging
  [ -n "${WS_AUTH_TOKEN:-}" ] && sed -i "s|^WS_AUTH_TOKEN=.*|WS_AUTH_TOKEN=${WS_AUTH_TOKEN}|" vps/.env.staging
  [ -n "${PUBLIC_ORIGIN:-}" ] && sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=${PUBLIC_ORIGIN}|" vps/.env.staging

  cp .env.example .env
  [ -n "${POSTGRES_PASSWORD:-}" ] && sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" .env

  echo "[STAGING] vps/.env.staging et .env régénérés depuis les secrets CI."
else
  if [ ! -f "vps/.env.staging" ] && [ -f "vps/.env.staging.example" ]; then
    cp vps/.env.staging.example vps/.env.staging
    echo "[STAGING] vps/.env.staging créé depuis le template."
  fi

  if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp .env.example .env
    echo "[STAGING] .env créé depuis le template."
  fi
fi

DOCKER_CMD="docker"
if ! docker info >/dev/null 2>&1; then
  DOCKER_CMD="sudo docker"
fi

echo "[STAGING] Lancement du déploiement de l'environnement de Test / Staging..."
$DOCKER_CMD compose -f "$COMPOSE_FILE" up -d --build --remove-orphans
$DOCKER_CMD compose -f "$COMPOSE_FILE" ps

echo -e "\n\033[0;32m[STAGING OK] L'environnement de test est actif.\033[0m"
echo "  • Voir vps/.env.staging (ALLOWED_ORIGINS) pour l'URL publique exacte."
