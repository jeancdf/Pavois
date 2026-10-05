#!/usr/bin/env bash
# ==============================================================================
# SCRIPT DE HARDENING NIVEAU 1 — PROJET PAVOIS (VPS LINUX)
# ==============================================================================
# Ce script configure le système d'exploitation du VPS Linux pour :
#  1. Vérifier la présence d'une clé SSH (sécurité anti-lockout)
#  2. Sécuriser SSH (Désactiver root & mot de passe, autoriser uniquement les clés)
#  3. Appliquer le hardening du noyau Linux via sysctl (SYN flood, IP spoofing)
#  4. Configurer le pare-feu UFW en mode strict (DEFAULT DROP incoming)
#  5. Proposer l'installation de CrowdSec (protection anti-brute-force)
# ==============================================================================

set -euo pipefail

# Couleurs d'affichage
RED='\030[0;31m'
GREEN='\032[0;32m'
YELLOW='\033[1;33m'
BLUE='\034[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================================${NC}"
echo -e "${BLUE}   PAVOIS — SCRIPT DE HARDENING VPS LINUX (NIVEAU 1)                 ${NC}"
echo -e "${BLUE}======================================================================${NC}"

# Vérifier que le script est exécuté en root ou avec sudo
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}[ERREUR] Ce script doit être exécuté avec les privilèges root (sudo).${NC}"
   exit 1
fi

# ------------------------------------------------------------------------------
# 1. PRÉVENTION DU LOCKOUT SSH (Vérification des clés autorisées)
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[Étape 1/5] Vérification des clés SSH de l'utilisateur...${NC}"

SUDO_USER_NAME="${SUDO_USER:-root}"
USER_HOME=$(eval echo "~${SUDO_USER_NAME}")
AUTH_KEYS="${USER_HOME}/.ssh/authorized_keys"
ROOT_AUTH_KEYS="/root/.ssh/authorized_keys"

HAS_KEY=false
if [[ -f "$AUTH_KEYS" && -s "$AUTH_KEYS" ]]; then
    HAS_KEY=true
elif [[ -f "$ROOT_AUTH_KEYS" && -s "$ROOT_AUTH_KEYS" ]]; then
    HAS_KEY=true
fi

if [[ "$HAS_KEY" = false ]]; then
    echo -e "${RED}[ATTENTION CRITIQUE] Aucune clé SSH n'a été détectée dans ~/.ssh/authorized_keys !${NC}"
    echo -e "${RED}Si nous désactivons le mot de passe maintenant, vous serez DÉPOSITAIRE ET VERROUILLÉ du VPS !${NC}"
    echo -e "${YELLOW}Veuillez ajouter votre clé SSH publique (ex: id_ed25519.pub) dans ~/.ssh/authorized_keys avant de continuer.${NC}"
    read -p "Voulez-vous forcer la continuation quand même ? (y/N) : " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}Procédure interrompue par sécurité.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}[OK] Clé SSH publique détectée pour l'accès SSH.${NC}"
fi

# ------------------------------------------------------------------------------
# 2. SÉCURISATION DE SSH (SSHD HARDENING)
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[Étape 2/5] Configuration sécurisée de SSH...${NC}"

# Backup de la configuration d'origine
SSHD_CONFIG="/etc/ssh/sshd_config"
if [[ -f "$SSHD_CONFIG" && ! -f "${SSHD_CONFIG}.bak" ]]; then
    cp "$SSHD_CONFIG" "${SSHD_CONFIG}.bak"
    echo -e "${GREEN}[OK] Sauvegarde créée : ${SSHD_CONFIG}.bak${NC}"
fi

# Utilisation d'un fichier de drop-in dans sshd_config.d si supporté
SSHD_DROPIN_DIR="/etc/ssh/sshd_config.d"
if [[ -d "$SSHD_DROPIN_DIR" ]]; then
    CONF_FILE="${SSHD_DROPIN_DIR}/99-pavois-security.conf"
    echo -e "${BLUE}Création du fichier de sécurité : ${CONF_FILE}${NC}"
    cat << 'EOF' > "$CONF_FILE"
# Configuration de sécurité PAVOIS pour SSH
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
KbdInteractiveAuthentication no
X11Forwarding no
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
else
    echo -e "${BLUE}Mise à jour directe de ${SSHD_CONFIG}...${NC}"
    sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONFIG"
    sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD_CONFIG"
    sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' "$SSHD_CONFIG"
    sed -i 's/^#\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' "$SSHD_CONFIG"
fi

# Test de la syntaxe SSHD avant de redémarrer le service
if sshd -t; then
    systemctl restart ssh || systemctl restart sshd
    echo -e "${GREEN}[OK] Configuration SSH mise à jour et service redémarré avec succès.${NC}"
else
    echo -e "${RED}[ERREUR] Syntaxe SSHD invalide ! Restauration de la sauvegarde...${NC}"
    if [[ -f "${SSHD_CONFIG}.bak" ]]; then
        cp "${SSHD_CONFIG}.bak" "$SSHD_CONFIG"
    fi
    exit 1
fi

# ------------------------------------------------------------------------------
# 3. HARDENING DU NOYAU LINUX (SYSCTL)
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[Étape 3/5] Application du Hardening Noyau Sysctl...${NC}"

SYSCTL_CONF="/etc/sysctl.d/99-pavois-security.conf"
cat << 'EOF' > "$SYSCTL_CONF"
# Hardening Réseau & Noyau — Projet PAVOIS

# Protection contre le SYN Flood (DoS)
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.tcp_synack_retries = 2

# Bloquer l'IP Spoofing (Reverse Path Filtering)
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Interdire les redirections ICMP (Empêche l'empoisonnement de table de routage)
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0

# Interdire le routage par la source (Source Routing)
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0

# Ignorer les pings broadcast (Smurf Attack)
net.ipv4.icmp_echo_ignore_broadcasts = 1

# Ignorer les réponses d'erreur ICMP malformées
net.ipv4.icmp_ignore_bogus_error_responses = 1

# Masquer la dactyloscopie réseau (Timestamps TCP)
net.ipv4.tcp_timestamps = 0
EOF

sysctl --system > /dev/null
echo -e "${GREEN}[OK] Paramètres sysctl appliqués avec succès.${NC}"

# ------------------------------------------------------------------------------
# 4. CONFIGURATION DU PARE-FEU UFW
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[Étape 4/5] Configuration du pare-feu strict (UFW)...${NC}"

if ! command -v ufw &> /dev/null; then
    echo -e "${BLUE}Installation de UFW...${NC}"
    apt-get update -qq && apt-get install -y -qq ufw
fi

# 1. Politique par défaut
ufw default deny incoming > /dev/null
ufw default allow outgoing > /dev/null

# 2. Autoriser SSH (Port par défaut 22 ou détecté)
SSH_PORT=$(sshd -T 2>/dev/null | grep "^port " | awk '{print $2}' || echo "22")
ufw allow ${SSH_PORT}/tcp comment 'Accès SSH sécurisé' > /dev/null

ufw delete allow 443/tcp > /dev/null 2>&1 || true
ufw delete allow 5000/udp > /dev/null 2>&1 || true
ufw allow 8080/tcp comment 'Interface operateur' > /dev/null
ufw allow 8081/tcp comment 'Interface operateur staging' > /dev/null
ufw allow 41234/udp comment 'Trames signees des Pi' > /dev/null
ufw allow 41235/udp comment 'Trames signees des Pi (staging)' > /dev/null

echo "y" | ufw enable > /dev/null

echo -e "${GREEN}[OK] UFW activé en mode DEFAULT DROP.${NC}"
ufw status verbose

# ------------------------------------------------------------------------------
# 5. INSTALLATION / CONFIGURATION DE CROWDSEC
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[Étape 5/5] Détection de CrowdSec...${NC}"

if command -v crowdsec &> /dev/null; then
    echo -e "${GREEN}[OK] CrowdSec est déjà installé et actif sur ce VPS.${NC}"
else
    echo -e "${BLUE}CrowdSec n'est pas encore installé.${NC}"
    read -p "Voulez-vous installer CrowdSec automatique maintenant (recommandé) ? (Y/n) : " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ || -z $REPLY ]]; then
        echo -e "${BLUE}Installation du dépôt CrowdSec...${NC}"
        curl -s https://packagecloud.io/install/repositories/crowdsec/crowdsec/script.deb.sh | bash
        apt-get install -y -qq crowdsec crowdsec-firewall-bouncer-iptables
        echo -e "${GREEN}[OK] CrowdSec et le bouncer Firewall ont été installés avec succès !${NC}"
    else
        echo -e "${YELLOW}[SKIP] CrowdSec n'a pas été installé. Vous pourrez l'installer plus tard.${NC}"
    fi
fi

echo -e "\n${GREEN}======================================================================${NC}"
echo -e "${GREEN}   HARDENING NIVEAU 1 APPLIQUÉ AVEC SUCCÈS SUR LE VPS !               ${NC}"
echo -e "${GREEN}======================================================================${NC}"
echo -e "Résumé des protections activées :"
echo -e "  • SSH : Root désactivé, Mots de passe désactivés (Clés SSH obligatoires)."
echo -e "  • Noyau : Protection SYN Flood, Anti-IP Spoofing & ICMP Hardening via sysctl."
echo -e "  • Pare-feu UFW : Entrées bloquées par défaut, uniquement ${SSH_PORT}/tcp, 8080-8081/tcp et 41234-41235/udp."
echo -e "${BLUE}======================================================================${NC}"
