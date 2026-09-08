# Rapport de Sécurité Global — VPS & Architecture PAVOIS

**Projet** : PAVOIS (Protection Avancée de Voxels pour l'Observation et l'Identification de Signatures)  
**Date** : Septembre 2026  
**Statut** : ✅ Spécifié et Conforme aux exigences Zero-Trust  

---

## 1. Synthèse Executive & Démarche Zero-Trust

Le système **PAVOIS** est conçu pour être déployé en zone critique (anti-drone / défense). La sécurité repose sur le principe de la **Défense en Profondeur (Defense-in-Depth)** structurée en 4 niveaux hermétiques :

```
┌─────────────────────────────────────────────────────────────────────────┐
│ NIVEAU 1 : VPS LINUX (HARDENING & ZERO TRUST)                           │
│  • UFW Firewall (DEFAULT DROP), SSH restreint, sysctl hardening         │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ NIVEAU 2 : ISOLATION DOCKER & CONTENEURS                                │
│  • Conteneurs non-root (USER node), Read-Only rootfs, CapDrop ALL       │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ NIVEAU 3 : BACKEND NESTJS & FLUX UDP HMAC                               │
│  • Helmet, CORS strict, Rate Limiting, Validation DTO, HMAC SHA256      │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ NIVEAU 4 : BASE DE DONNÉES & PERSISTANCE PRISMA                         │
│  • PostgreSQL non exposé, TLS obligatoire, privilèges restreints        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Tableau de Conformité Global

| Niveau | Domaine | Protection Mise en Œuvre | Statut |
| :--- | :--- | :--- | :---: |
| **Niveau 1** | VPS Linux | Pare-feu UFW Default Drop, SSH clés Ed25519 uniquement | ✅ |
| **Niveau 1** | Noyau Linux | Protection SYN Flood, Anti-IP Spoofing via sysctl | ✅ |
| **Niveau 2** | Runtime Docker | Utilisateur `node` (Non-Root UID 1000) | ✅ |
| **Niveau 2** | Système de Fichiers | Image en Lecture Seule (`read_only: true`), RAM `tmpfs` | ✅ |
| **Niveau 2** | Privilèges Noyau | Suppression totale des capacités noyau (`cap_drop: ALL`) | ✅ |
| **Niveau 3** | Sécurité Web | HTTP Helmet, CORS strict et Rate Limiting Throttler | ✅ |
| **Niveau 3** | Ingestion UDP | Signature HMAC-SHA256 & Anti-Replay Timestamp (2000ms) | ✅ |
| **Niveau 4** | Base de données | PostgreSQL isolé en réseau privé Docker bridge | ✅ |

---

## 3. Guide de Validation Rapide

* **Vérifier l'utilisateur non-root** : `docker exec pavois-vps-server whoami` -> Output `node`
* **Vérifier le Read-Only** : `docker exec pavois-vps-server touch /app/test.txt` -> Output `Read-only file system`
* **Vérifier le pare-feu** : `sudo ufw status` -> Output `Status: active`
