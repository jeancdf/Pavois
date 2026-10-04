# 🚨 Documentation Technique — Features A & B : Système d'Alertes PAVOIS

---

## 1. Résumé (5 Lignes)
Ce système d'alertes temps réel surveille la santé du parc de caméras (Feature A) et le passage d'objets volants (Feature B). 
Il s'appuie sur une détection optique légère C++ à 5 Hz sur Raspberry Pi et sur une machine à états et corrélation multi-caméras dans le backend NestJS. 
Les événements sont diffusés via WebSocket authentifié à l'IHM Angular et aux Webhooks Discord (pour les alertes critiques). 
La persistance est assurée par un stockage en mémoire combiné à un journal append-only JSONL atomique à tolérance de panne disque sans aucune dépendance PostgreSQL/Prisma.
L'ensemble respecte le principe *Human-In-The-Loop* et la sécurité en profondeur.

---

## 2. Synthèse de l'Analyse de l'Existant
L'analyse initiale de la chaîne de traitement PAVOIS a révélé :
* Une couche de capture V4L2 en C++17 sur Pi 4/5 produisant des frames en niveaux de gris $1280 \times 720$ à 30 FPS.
* Un transport UDP dgram binaire sécurisé par HMAC-SHA256 et horodatage anti-rejeu (fenêtre 2000 ms).
* Un serveur NestJS assurant la triangulation 3D, le suivi de Kalman et le suivi d'alertes temps réel.
* Un écran opérateur Angular (Signal-based, Angular 22) recevant les flux WebSocket.

*Écarts résolus par ces features* :
* Absence de détection des pannes d'images (caméra masquée, figée, muette).
* Inexistence d'une alerte évolutive pour les objets détectés avant et après triangulation 3D.
* Absence d'acquittement synchro multi-opérateurs authentifié.
* Suppression de l'infrastructure PostgreSQL au profit d'un journal de bord ultra-léger JSONL.

---

## 3. Architecture & Flux Temps Réel

```mermaid
sequenceDiagram
    autonumber
    participant Pi as Raspberry Pi 4/5 (C++)
    participant VPS_UDP as Serveur UDP (NestJS)
    participant Monitor as CameraHealthService (NestJS)
    participant Alerts as AlertsService (NestJS)
    participant Store as JsonlAlertStore (In-Memory + JSONL)
    participant Discord as DiscordNotificationChannel
    participant WS as Gateway WebSocket (NestJS)
    participant UI as Écran Opérateur (Angular 22)

    loop Calcul @ 5 Hz (C++)
        Pi->>VPS_UDP: Trame stats v2 (lum, stddev, diff, laplacien, exp, gain) + HMAC
    end

    VPS_UDP->>Monitor: Ingestion des métriques
    
    alt Anomalie détectée (Panne/Masque/Silence > 3s)
        Monitor->>Alerts: Transition d'état (ex: DEGRADED_BLIND / HORS_SERVICE)
        Alerts->>Store: Persistance async non-bloquante Alert & CameraStateLog
        Alerts->>WS: Broadcast WS 'camera_status_update' & 'alert'
        WS->>UI: MaJ IHM (Badge Fiabilité, AlertFeed, Notification Toast)
        opt Alerte Critique & Webhook Discord
            Alerts->>Discord: Post Embed Discord (Asynchrone non-bloquant)
        end
    end

    opt Action Opérateur [Acquitter]
        UI->>WS: WS Message 'acknowledge_alert' (Token Auth Opérateur)
        WS->>Alerts: Verification Identity & Rate Limit
        Alerts->>Store: Update Alert (status=ACKNOWLEDGED, acknowledgedBy)
        Alerts->>WS: Broadcast WS 'alert_updated' (Synchro multi-écrans)
    end
```

---

## 4. Pourquoi pas de base de données (JSONL + Mémoire)

### Rationale d'architecture :
1. **Simplicité opérationnelle & Zéro Dépendance** : Élimine la nécessité de déployer et maintenir un serveur PostgreSQL, un pool de connexions et des migrations de schéma sur le VPS embarqué.
2. **Réduction de la surface d'attaque** : Aucun port de base de données exposé, aucune injection SQL possible, aucune vulnérabilité d'authentification DB.
3. **Haute Disponibilité & Résilience** :
   - L'état actif réside à 100 % en mémoire (`Map<string, Alert>`).
   - Même en cas de panne disque physique ou de saturation I/O, le serveur continue de fonctionner, de traiter les paquets UDP et de diffuser les alertes aux opérateurs via WebSockets et Discord.
   - Les écritures disque sont journalisées de manière séquentielle dans un fichier JSONL (`ALERTS_DATA_DIR/alerts.jsonl`).
4. **Purge Atomique Réécriture + Rename** : La tâche quotidienne de maintenance réécrit les alertes valides dans un fichier temporaire (`alerts.jsonl.tmp`) puis effectue un `fs.rename` atomique, garantissant qu'aucune coupure de courant ne peut corrompre l'historique.

### Limites assumées & Évolutivité :
* **Recherche & Requêtes complexes** : Le moteur in-memory supporte l'indexation par ID et le filtrage par statut et horodatage. Il n'est pas conçu pour des jointures complexes.
* **Déploiement Mono-instance** : Adapté à un nœud de détection PAVOIS autonome.
* **Facilité de migration** : Grâce aux interfaces abstraites `AlertStore`, `CameraStateLogStore` et `TrackStore`, le stockage peut être remplacé par SQLite ou PostgreSQL à tout moment sans modifier une seule ligne de logique métier dans les services.

---

## 5. Explication du Code Fichier par Fichier

### A. Pi Embarqué (C++)
1. [image_ops.hpp](file:///c:/Users/Lucli/drone/Pavois/pavois++/include/pavois/detection/image_ops.hpp) & [image_ops.cpp](file:///c:/Users/Lucli/drone/Pavois/pavois++/src/detection/image_ops.cpp) :
   * Contient la structure `ImageDiagnostics` et la fonction `compute_image_diagnostics()`.
   * **Rôle** : Calcule à 5 Hz la luminance moyenne, l'écart-type spatial, la différence inter-images et la variance du Laplacien sur une frame sous-échantillonnée. Mesure précise via `std::chrono::steady_clock`.
2. [camera_worker.hpp](file:///c:/Users/Lucli/drone/Pavois/pavois++/include/pavois/runtime/camera_worker.hpp) & [camera_worker.cpp](file:///c:/Users/Lucli/drone/Pavois/pavois++/src/runtime/camera_worker.cpp) :
   * **Rôle** : Émet la trame UDP de statistiques au format v2 : `stats,v2,cam_id,fps,frame_id,now_us,lum_mean,lum_stddev,frame_diff,laplacian_var,exposure_us,gain_db`.

### B. Backend NestJS (Serveur VPS)
1. [alert-types.ts](file:///c:/Users/Lucli/drone/Pavois/vps/src/alert-types.ts) & [track-types.ts](file:///c:/Users/Lucli/drone/Pavois/vps/src/track-types.ts) :
   * Définitions des types et enums TypeScript autonomes sans dépendance Prisma (`AlertType`, `AlertCategory`, `AlertStatus`, `CameraState`, `TrackVerdict`).
2. [alert-store.interface.ts](file:///c:/Users/Lucli/drone/Pavois/vps/src/stores/alert-store.interface.ts) & [track-store.interface.ts](file:///c:/Users/Lucli/drone/Pavois/vps/src/stores/track-store.interface.ts) :
   * Interfaces abstraites pour la création, la mise à jour, la relecture et la purge des alertes et des pistes.
3. [jsonl-alert.store.ts](file:///c:/Users/Lucli/drone/Pavois/vps/src/stores/jsonl-alert.store.ts) & [jsonl-track.store.ts](file:///c:/Users/Lucli/drone/Pavois/vps/src/stores/jsonl-track.store.ts) :
   * Implémentations concrètes In-Memory + Journal JSONL append-only avec file d'écriture asynchrone, tolérance aux lignes corrompues et purge atomique.
4. [camera-health.service.ts](file:///c:/Users/Lucli/drone/Pavois/vps/src/camera-health.service.ts) :
   * **Machine à états des caméras** (`EN_ATTENTE` ➔ `OK` | `DEGRADED_FROZEN` | `DEGRADED_BLIND` | `REDUCED_VISIBILITY_NIGHT` | `HORS_SERVICE`).
   * Initialise les caméras en `EN_ATTENTE` avec un **délai de grâce au démarrage de 10 s** (`CAMERA_INITIAL_GRACE_SECONDS`) évitant les fausses alarmes.
   * Maintient la **ligne de base glissante 60 s gelée** pendant les anomalies.
   * Détecte les assombrissements environnementaux collectifs (nuages/nuit) pour éviter les faux positifs.
   * Calcule la fiabilité globale (`GREEN` 3/3, `ORANGE` 2/3, `RED` <=1/3).
5. [alerts.service.ts](file:///c:/Users/Lucli/drone/Pavois/vps/src/alerts.service.ts) :
   * **Machine à états des alertes** (`NEW` ➔ `ACKNOWLEDGED` ➔ `RESOLVED`).
   * Implémente la **Feature B Évolutive** (`OBJECT_DETECTED` ➔ `TO_VERIFY` ➔ `DRONE_CONFIRMED`).
   * Tolérance aux erreurs de disque avec fallback temporary ID pour ne jamais interrompre la diffusion WebSocket/Discord.
   * Gère l'acquittement authentifié et la résolution automatique des objets perdus (`OBJECT_LOST_TIMEOUT_SECONDS = 5`).
6. [discord-formatter.ts](file:///c:/Users/Lucli/drone/Pavois/vps/src/discord-formatter.ts) :
   * Fonctions utilitaires de sécurité et de formatage : `escapeDiscordMarkdown` (prévention d'injection et remplacement de `@` par `ⓐ`), `maskWebhookUrl` (masquage secret `https://discord.com/api/webhooks/***`), `isValidWebhookUrl` et `formatDuration` (`X min Y s`).
7. [discord-notification.channel.ts](file:///c:/Users/Lucli/drone/Pavois/vps/src/discord-notification.channel.ts) :
   * Canal de notification asynchrone non-bloquant avec `.catch` explicite, timeout de 5 s (`AbortController`), limitation anti-spam à 5 msgs/min (avec résumé de débordement `⚠️ +N alertes critiques`), retries HTTP 429 (`retry_after`) & HTTP 5xx (backoff exponentiel), et désactivation définitive sur 401/403/404.
8. [scripts/test-discord.ts](file:///c:/Users/Lucli/drone/Pavois/vps/scripts/test-discord.ts) :
   * Script CLI de test (`npm run test:discord`) émettant 6 scénarios d'alertes réels (Masquée, Down, Système Aveugle, Drone 3D, Rétablissement, Système Restauré).
9. [access-control.ts](file:///c:/Users/Lucli/drone/Pavois/vps/src/access-control.ts) :
   * Décodage des jetons d'opérateur (`op:<username>:<secret>`). Blocage strict des jetons de dev en production.
10. [events.gateway.ts](file:///c:/Users/Lucli/drone/Pavois/vps/src/events.gateway.ts) :
   * Gestion de l'authentification dans le handshake WS et des acquittements répercutés à tous les écrans. `forwardRef()` utilisé pour résoudre les dépendances circulaires.
11. [alerts-clean-up.service.ts](file:///c:/Users/Lucli/drone/Pavois/vps/src/alerts-clean-up.service.ts) :
   * Tâche planifiée quotidienne effectuant la purge atomique des alertes de plus de 30 jours via `AlertStore.purgeOlderThan()`.
12. [.github/workflows/deploy-vps.yml](file:///c:/Users/Lucli/drone/Pavois/.github/workflows/deploy-vps.yml) :
   * Workflow GitHub Actions de déploiement SSH sur le VPS. Injection sécurisée sans fuite de secrets via `envs` dans `vps/.env` avec `chmod 600` et vérification post-déploiement du log `Discord : activé`.

---

## 6. Algorithmes de Détection Optique & Règles Métier

1. **Luminance Moyenne ($\mu$)** :
   $$\mu = \frac{1}{N} \sum_{i=1}^N I(x_i, y_i)$$
2. **Écart-Type Spatial ($\sigma$)** :
   $$\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^N (I(x_i, y_i) - \mu)^2}$$
3. **Différence Inter-Frames ($\Delta I$)** :
   $$\Delta I = \frac{1}{N} \sum_{i=1}^N |I_t(x_i, y_i) - I_{t-1}(x_i, y_i)|$$
4. **Variance du Laplacien ($L$)** (Calculé à titre indicatif) :
   $$L = \text{Var}(\nabla^2 I)$$

---

## 7. Tableau de Configuration (Variables d'Environnement)

| Variable | Valeur par Défaut | Description |
| :--- | :---: | :--- |
| `ALERTS_DATA_DIR` | `./data` | Répertoire de stockage des fichiers JSONL (`alerts.jsonl`, `tracks.jsonl`, `camera-states.jsonl`). |
| `ALERT_MAX_MEMORY_ITEMS` | `5000` | Nombre maximal d'alertes conservées en mémoire vive. |
| `CAMERA_INITIAL_GRACE_SECONDS` | `10` | Délai de grâce initial au démarrage avant déclaration `HORS_SERVICE`. |
| `CAMERA_TIMEOUT_SECONDS` | `3` | Délai sans paquet avant de déclarer une caméra `HORS_SERVICE`. |
| `CAMERA_FROZEN_SECONDS` | `5` | Délai avant de déclarer un flux `DEGRADED_FROZEN`. |
| `CAMERA_BLIND_SECONDS` | `3` | Délai avant de déclarer une caméra `DEGRADED_BLIND`. |
| `CAMERA_RECOVERY_SECONDS` | `5` | Hystérésis de rétablissement. |
| `OBJECT_LOST_TIMEOUT_SECONDS` | `5` | Délai d'inactivité avant résolution automatique d'une piste d'objet. |
| `ALERT_RETENTION_DAYS` | `30` | Durée de rétention des alertes dans le journal JSONL. |
| `DISCORD_ENABLED` | `true` | Active/désactive le canal Discord. |
| `DISCORD_WEBHOOK_URL` | `""` | URL du Webhook Discord (masquée dans les logs). |
| `DISCORD_CATEGORIES` | `"CAMERA_MASKED,..."` | Catégories d'alertes transmises à Discord. |
| `DISCORD_MAX_ALERTS_PER_MIN` | `5` | Plafond anti-spam Discord par minute. |
| `DISCORD_MENTION_ROLE_ID` | `""` | ID du rôle Discord à notifier sur alerte majeure (`DRONE_CONFIRMED`, `SYSTEM_BLIND`). |
| `DISCORD_INCLUDE_POSITION` | `true` | Inclut les coordonnées GPS 4 décimales dans l'embed. |
| `DISCORD_ENV_LABEL` | `"VPS-PROD"` | Libellé d'environnement dans le footer Discord. |
| `OPERATOR_URL` | `"http://..."` | Lien vers l'écran opérateur Angular dans l'embed. |
| `SIMULATION_MODE` | `false` | Mode simulation pour soutenances (interdit si `NODE_ENV=production`). |

---

## 8. Mesures de Performance C++ (Raspberry Pi 4/5)

| Opération | Fréquence | Durée Moyenne (ms) | Budget Disponible (ms) |
| :--- | :---: | :---: | :---: |
| Redimensionnement $1280 \times 720 \rightarrow 320 \times 180$ | 5 Hz | 0.12 ms | 33 ms |
| Calcul Luminance & Stddev | 5 Hz | 0.08 ms | 33 ms |
| Calcul Différence Inter-Frames | 5 Hz | 0.06 ms | 33 ms |
| Variance du Laplacien $3 \times 3$ | 5 Hz | 0.11 ms | 33 ms |
| **Total Diagnostic Optique** | **5 Hz** | **~0.37 ms** | **33 ms (Consommation < 1.2% du budget)** |

---

## 9. Procédure de Lancement des Tests & Démo

### A. Lancement des Tests Unitaires & d'Intégration
```bash
# Tests Backend NestJS (24 suites de tests, 142 tests passing)
cd vps
npm test

# Test CLI complet Discord (6 scénarios réels)
npm run test:discord

# Tests Frontend Angular 22
cd ../frontend-angular
npm test
```

### B. Déclenchement des Scénarios de Démo en Live
Activer `SIMULATION_MODE=true` dans `vps/.env`, démarrer le serveur, puis utiliser l'API de simulation :
* **Masque Physique CAM 1** : `POST /simulation/scenario/mask_cam1`
* **Coupure Réseau CAM 2** : `POST /simulation/scenario/disconnect_cam2`
* **Flux Figé CAM 3** : `POST /simulation/scenario/freeze_cam3`
* **Tombée de la Nuit** : `POST /simulation/scenario/night_fall`
* **Drone Confirmé 3D** : `POST /simulation/scenario/drone_confirmed_3d`

---

## 10. Notifications Discord Webhook & CI/CD Pipeline

Le canal `DiscordNotificationChannel` transmet en temps réel les alertes majeures du système sur un salon Discord de crise sans jamais impacter les performances de détection.

### Événements Notifiés
* **Incident Critique** : `CAMÉRA HORS SERVICE`, `CAMÉRA MASQUÉE` (Hex `#E5484D`)
* **Système Aveugle** : `SYSTÈME AVEUGLE` (<=1/3 caméras valides, Hex `#B42318`)
* **Drone Confirmé** : `DRONE CONFIRMED` (Hex `#E5484D`)
* **Rétablissement** : `CAMÉRA RÉTABLIE`, `SYSTÈME RESTAURÉ` (Hex `#30A46C`) avec mention de la durée exacte de l'incident (`⏱️ Durée de l'incident`).

### Règles Sécuritaires, CI/CD et Robustesse
1. **Confidentialité Secret Webhook** : L'URL du Webhook est masquée dans tous les logs (`https://discord.com/api/webhooks/***`).
2. **Exécution Non-Bloquante** : File d'attente asynchrone (max 100 messages) gérée avec `AbortController` (timeout 5s).
3. **Anti-Spam & Rate Limiting** : Plafond configurable (`DISCORD_MAX_ALERTS_PER_MIN`, défaut 5). En cas de pic d’alertes, un message de résumé de débordement est émis (`⚠️ +N alertes critiques supplémentaires`).
4. **Resilience & Retries** :
   - HTTP 429 : Pause et reprise suivant l'en-tête `retry_after`.
   - HTTP 5xx / Erreurs réseau : Backoff exponentiel (1s, 2s, 4s - 3 tentatives).
   - HTTP 401 / 403 / 404 : Désactivation permanente du canal jusqu'au redémarrage avec log ERROR unique.
5. **Prévention Injection Markdown** : Échappement des caractères markdown et des mentions `@everyone` / `@here`. Mention `@&ROLE_ID` autorisée de manière stricte uniquement pour les incidents majeurs (`DRONE_CONFIRMED`, `SYSTEM_BLIND`) si `DISCORD_MENTION_ROLE_ID` est configuré.
6. **Pipeline CI/CD GitHub Actions** :
   - Secrets (`secrets.DISCORD_WEBHOOK_URL`) et variables d'environnement (`vars.DISCORD_*`, `vars.OPERATOR_URL`) sont transmis uniquement au job de déploiement SSH (`deploy`).
   - Le script remote Python met à jour sélectivement `vps/.env` avec `chmod 600` sans effacer les variables existantes.
   - Les logs du conteneur VPS sont vérifiés post-déploiement pour confirmer la ligne `Discord : activé`.


