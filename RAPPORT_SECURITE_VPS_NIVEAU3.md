# Rapport de Sécurité Niveau 3 — Sécurité Applicative NestJS & Protection des Flux UDP

**Projet** : PAVOIS (Protection Avancée de Voxels pour l'Observation et l'Identification de Signatures)  
**Niveau de Sécurité** : 3 sur 4 (Sécurité Applicative, En-têtes HTTP, Anti-DoS & Authentification HMAC UDP)  
**Date** : Septembre 2026  
**Statut** : ✅ Spécifié, implémenté et prêt pour déploiement  

---

## 1. Comprendre le Niveau 3 en 1 Minute (Synthèse pour l'Équipe & le Jury)

> **Analogie Pédagogique : "Le Filtre d'Identité et le Détecteur de Falsification"**
> 
> * **Niveau 1 & 2** : Le château est protégé par des remparts (UFW/SSH) et l'intérieur est confiné (Conteneurs Docker hermétiques non-root).
> * **Niveau 3** : Nous protégeons la **logique applicative et les flux de télémesure** en temps réel contre la corruption de données et l'usurpation :
>   1. **En-têtes HTTP Helmet** : Le serveur Web masque son identité et bloque les injections XSS, Sniffing et Clickjacking.
>   2. **CORS Strict** : Seuls les domaines et clients autorisés (`ALLOWED_ORIGINS`) peuvent dialoguer avec l'API ou se connecter aux WebSockets.
>   3. **Rate Limiting Anti-DoS (`@nestjs/throttler`)** : Un client malveillant tentant d'inonder le serveur de requêtes HTTP est bloqué automatiquement (HTTP 429).
>   4. **Validation DTO Stricte** : Tout message contenant des propriétés non autorisées ou des types corrompus est immédiatement rejeté avant d'atteindre le cœur applicatif.
>   5. **Authentification HMAC-SHA256 & Anti-Replay UDP** : Chaque paquet de télémesure de caméra UDP est signé cryptographiquement et horodaté (fenêtre de 2 sec), rendant l'injection de faux drones (**UDP Spoofing**) impossible.

---

## 2. Architecture de la Défense en Profondeur

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        INTERNET / RÉSEAU PUBLIC                         │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ NIVEAU 1 : HARDENING HÔTE VPS LINUX (VALIDE)                            │
│  • UFW Firewall (Ports 22, 443, 5000 uniquement)                        │
│  • SSH Clés Ed25519 uniquement (Mots de passe & root bloqués)          │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ NIVEAU 2 : ISOLATION DOCKER & CONTENEURS (VALIDE)                       │
│  • Non-root (`USER node`), `read_only: true`, `cap_drop: ALL`           │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 🛡️ NIVEAU 3 : SÉCURITÉ APPLICATIVE & UDP HMAC (CE RAPPORT)              │
│                                                                         │
│  [1] `Helmet` ────────────────► HSTS, CSP, Anti-Clickjacking            │
│  [2] `CORS Strict` ───────────► Rejet origines non autorisées           │
│  [3] `Throttler` ─────────────► Rate Limiting 100 req/min (Anti-DoS)    │
│  [4] `ValidationPipe` ────────► Whitelist DTO stricte (Anti-injection)  │
│  [5] `HMAC-SHA256 UDP` ───────► Signature paquets & Anti-Replay 2000ms   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Détail Technique des 5 Piliers du Niveau 3

### Pilier 1 : Protection HTTP Helmet (`vps/src/main.ts`)
* **Le Risque** : Divulgation de la pile technique (`X-Powered-By: Express`), vulnérabilités Clickjacking ou attaques par renforcement de type de contenu.
* **La Solution PAVOIS** : Intégration du middleware `helmet()` dans NestJS.
* **Résultat** : Suppression automatique des en-têtes révélateurs et ajout dynamique de `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`.

### Pilier 2 : Politique CORS Stricte (`vps/src/main.ts`)
* **Le Risque** : L'utilisation de `origin: '*'` autorise n'importe quel site tiers à exécuter des requêtes vers le backend.
* **La Solution PAVOIS** : Filtrage dynamique des origines via `ALLOWED_ORIGINS`.

### Pilier 3 : Rate Limiting Anti-DoS (`@nestjs/throttler`)
* **Le Risque** : Attaque par déni de service applicatif visant à épuiser la mémoire RAM ou les ressources CPU du serveur VPS.
* **La Solution PAVOIS** : Déclaration du `ThrottlerGuard` global avec un quota de **100 requêtes maximum par minute et par IP**.

### Pilier 4 : Validation Stricte des DTOs (`ValidationPipe`)
* **La Solution PAVOIS** : Configuration du `ValidationPipe` avec `whitelist: true` et `forbidNonWhitelisted: true`.

### Pilier 5 : Authentification HMAC-SHA256 & Anti-Replay UDP (`vps/src/udp.service.ts`)
* **Le Risque** : En UDP, un pirate peut forger un paquet réseau (**UDP Spoofing**) et faire apparaître de faux voxels ou fausses trajectoires de drones.
* **La Solution PAVOIS** : Vérification de la signature cryptographique `HMAC-SHA256` et de l'horodatage Unix (fenêtre de **2000 ms**).

---

## 4. Grille de Contrôle pour l'Homologation de Sécurité

| Élément contrôlé | Mécanisme de Protection | Statut | Risque Couvert |
| :--- | :--- | :---: | :--- |
| **En-têtes HTTP** | Middleware `helmet()` | ✅ | XSS, Clickjacking, Information Disclosure |
| **Politique CORS** | Filtrage dynamique par `ALLOWED_ORIGINS` | ✅ | Cross-Origin Data Exfiltration |
| **Rate Limiting** | Throttler (100 req / min par IP) | ✅ | Déni de service (DoS HTTP) |
| **DTOs & Payloads** | `ValidationPipe` strict (`whitelist: true`) | ✅ | Injection de données corrompues |
| **Télémétrie UDP** | Signature HMAC-SHA256 + Anti-Replay Timestamp (2 sec) | ✅ | Usurpation d'identité capteur (UDP Spoofing) |
