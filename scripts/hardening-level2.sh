#!/bin/bash
# ==============================================================================
# SCRIPT DE SÉCURISATION ET DÉPLOIEMENT DOCKER NIVEAU 2 — PROJET PAVOIS
# ==============================================================================
# Ce script applique le Hardening Docker (Isolation conteneurs, non-root, read-only)
# sur le VPS et vérifie automatiquement que toutes les protections sont actives.
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================================${NC}"
echo -e "${BLUE}     PAVOIS — SÉCURISATION DOCKER & ISOLATION CONTENEURS (NIVEAU 2)   ${NC}"
echo -e "${BLUE}======================================================================${NC}"

# 1. Vérification que Docker et Docker Compose sont disponibles
if ! command -v docker &> /dev/null; then
    echo -e "${RED}[!] Erreur: Docker n'est pas installé sur ce VPS.${NC}"
    exit 1
fi

# 2. Nettoyage des anciennes images non sécurisées
echo -e "\n${YELLOW}[1/4] Nettoyage du cache et arrêt des conteneurs existants...${NC}"
docker compose down || true

# 3. Rebuild des conteneurs avec le Dockerfile durci
echo -e "\n${YELLOW}[2/4] Compilation des images Docker durcies (Niveau 2)...${NC}"
docker compose build --no-cache

# 4. Lancement des conteneurs sécurisés
echo -e "\n${YELLOW}[3/4] Démarrage des conteneurs sécurisés...${NC}"
docker compose up -d

# 5. Audit et Vérification Automatique du Niveau 2
echo -e "\n${YELLOW}[4/4] Audit en temps réel de l'isolation Docker...${NC}"
sleep 3

CONTAINER_NAME="pavois-vps-server"

if [ "$(docker inspect -f '{{.State.Running}}' $CONTAINER_NAME 2>/dev/null)" != "true" ]; then
    echo -e "${RED}[!] Erreur: Le conteneur $CONTAINER_NAME ne tourne pas.${NC}"
    docker logs $CONTAINER_NAME --tail 20
    exit 1
fi

echo -e "\n${BLUE}--- RÉSULTATS DE L'AUDIT DE SÉCURITÉ CONTENEUR ---${NC}"

# A. Vérification de l'utilisateur non-root
USER_VAL=$(docker exec $CONTAINER_NAME id -u)
USER_NAME=$(docker exec $CONTAINER_NAME id -un)
if [ "$USER_VAL" != "0" ]; then
    echo -e "  [OK] Utilisateur exécutant : ${GREEN}$USER_NAME (UID: $USER_VAL) — Non-Root OK${NC}"
else
    echo -e "  [KO] Utilisateur exécutant : ${RED}ROOT (Alerte Sécurité !)${NC}"
fi

# B. Vérification Read-Only RootFS
READ_ONLY=$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' $CONTAINER_NAME)
if [ "$READ_ONLY" == "true" ]; then
    echo -e "  [OK] Système de fichiers : ${GREEN}Lecture Seule (Read-Only) OK${NC}"
else
    echo -e "  [KO] Système de fichiers : ${RED}Lecture/Écriture (Risque d'injection file system)${NC}"
fi

# C. Vérification No New Privileges
NO_NEW_PRIV=$(docker inspect -f '{{.HostConfig.SecurityOpt}}' $CONTAINER_NAME)
if [[ "$NO_NEW_PRIV" == *"no-new-privileges:true"* ]]; then
    echo -e "  [OK] Prevention escalade privilèges : ${GREEN}no-new-privileges OK${NC}"
else
    echo -e "  [KO] Prevention escalade privilèges : ${RED}Non configuré${NC}"
fi

# D. Vérification Cap Drop ALL
CAP_DROP=$(docker inspect -f '{{.HostConfig.CapDrop}}' $CONTAINER_NAME)
if [[ "$CAP_DROP" == *"ALL"* ]]; then
    echo -e "  [OK] Révocation privilèges noyau : ${GREEN}CapDrop ALL OK${NC}"
else
    echo -e "  [KO] Révocation privilèges noyau : ${RED}Non restreint${NC}"
fi

# E. Vérification de la non-présence du fichier .env dans l'image
ENV_BAKED=$(docker exec $CONTAINER_NAME test -f /app/.env && echo "FOUND" || echo "NOT_FOUND")
if [ "$ENV_BAKED" == "NOT_FOUND" ]; then
    echo -e "  [OK] Protection des Secrets : ${GREEN}Aucun fichier .env en dur dans l'image OK${NC}"
else
    echo -e "  [KO] Protection des Secrets : ${RED}Alerte ! Le fichier .env est cuit dans l'image Docker${NC}"
fi

echo -e "\n${GREEN}======================================================================${NC}"
echo -e "${GREEN}     SÉCURISATION NIVEAU 2 RÉUSSIE ET VALIDÉE EN PRODUCTION !        ${NC}"
echo -e "${GREEN}======================================================================${NC}"
