# Guide de Sécurité Globale — Projet PAVOIS (VPS, Docker, Backend & UDP)

Ce document est le guide de référence pour sécuriser l'ensemble de l'architecture du projet **PAVOIS** (Projection Avancée de Voxels pour l'Observation et l'Identification de Signatures). 

Conçu selon le principe de **Défense en Profondeur (Defense-in-Depth)** et du **Zero-Trust**, ce guide détaille chaque mesure de sécurité, la raison technique de son existence, et les étapes exactes d'implémentation.

---

## Vue d'Ensemble de la Stratégie de Sécurité

Dans un système tactique d'anti-drone, le système doit résister à trois types de menaces principales :
1. **Usurpation de capteur (UDP Spoofing)** : Injection de fausses positions de drones par un attaquant réseau.
2. **Prise de contrôle du VPS (Container Escape / SSH Brute Force)** : Compromission du serveur par faille système.
3. **Déni de Service (DoS / Resource Exhaustion)** : Saturation du backend par envoi massif de requêtes HTTP/UDP.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          INTERNET / RÉSEAU PUBLIC                       │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ NIVEAU 1 : VPS LINUX (HARDENING & ZERO TRUST)                           │
│  • SSH bridé sur Tailscale/WireGuard (Port SSH masqué)                  │
│  • UFW / NFTables (DEFAULT DROP, ports 443 TCP & 5000 UDP signés)       │
│  • CrowdSec (Détection et bannissement automatique des IP suspectes)    │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ NIVEAU 2 : ISOLATION DOCKER                                             │
│  • Conteneurs non-root (`USER node`)                                    │
│  • Système de fichiers en lecture seule (`read_only: true`)             │
│  • Révocation des privilèges noyau (`cap_drop: ALL`)                    │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ NIVEAU 3 : BACKEND NESTJS & FLUX UDP                                    │
│  • Authentification des paquets UDP par signature HMAC-SHA256           │
│  • Helmet (En-têtes HTTP de sécurité HSTS, CSP, X-Frame-Options)        │
│  • CORS strict (Pas d'origine `*`)                                      │
│  • Rate Limiting (Throttler) & Validation Zod/ValidationPipe            │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ NIVEAU 4 : BASE DE DONNÉES POSTGRESQL & PRISMA                          │
│  • Port 5432 non exposé sur Internet (Réseau privé Docker uniquement)   │
│  • Rôle applicatif non-superuser avec TLS obligatoire                   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Hardening du VPS Linux (Système d'Exploitation)

### A. Sécurisation de l'Accès SSH
Par défaut, SSH écoute sur le port 22 et accepte les connexions root ou par mot de passe, ce qui expose le VPS à des tentatives de brute-force.

**Actions dans `/etc/ssh/sshd_config` :**
```ini
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
KbdInteractiveAuthentication no
```
*Redémarrer le service* : `sudo systemctl restart ssh`

---

### B. Pare-feu Réseau Strict (UFW)
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 443/tcp
sudo ufw allow 5000/udp
sudo ufw allow 22/tcp
sudo ufw enable
```

---

### C. Hardening du Noyau Linux (`sysctl`)
Fichier `/etc/sysctl.d/99-pavois-security.conf` :
```ini
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
```

---

## 2. Hardening Docker et Conteneurisation

### A. Sécurisation du `Dockerfile`
* Utilisateur non-privilégié `USER node`.
* Aucun fichier `.env` cuit dans l'image.

### B. Configuration `docker-compose.yml`
```yaml
security_opt:
  - no-new-privileges:true
read_only: true
tmpfs:
  - /tmp:exec,mode=1777
cap_drop:
  - ALL
cap_add:
  - NET_BIND_SERVICE
mem_limit: 512m
```

---

## 3. Sécurisation Backend & Ingestion UDP HMAC-SHA256

* **Helmet & CORS Strict** : Filtrage des origines et masquage des en-têtes HTTP.
* **Rate Limiting** : Protection contre le DoS applicatif.
* **Validation Pipe** : Filtrage strict des DTOs.
* **Signature HMAC-SHA256 UDP & Anti-Replay** : En-tête binaire de 40 octets avec horodatage Unix pour empêcher l'usurpation de capteurs.

---

## 4. Checklist d'Audit de Sécurité

| Domaine | Élément de Sécurité | Statut |
| :--- | :--- | :---: |
| **VPS Linux** | SSH sur clé Ed25519 & Root désactivé | ✅ |
| **VPS Linux** | Pare-feu UFW DEFAULT DROP | ✅ |
| **Docker** | Conteneur sous utilisateur non-root | ✅ |
| **Docker** | Système de fichiers en `read_only` | ✅ |
| **Backend** | Helmet & CORS strict | ✅ |
| **Réseau UDP** | Signature HMAC-SHA256 & Anti-Replay | ✅ |
