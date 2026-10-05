[← Découvrir PAVOIS](01-decouvrir-pavois.md) · [🏠 Accueil](README.md) · [Le détecteur sur les Pi →](03-detecteur-pi.md)

# 🧱 Architecture

> Trois programmes, trois rôles : **la Pi voit**, **le VPS comprend**, **le
> navigateur montre**. Ils ne partagent rien d'autre que des messages.

---

## 🧩 Les trois composants

| Composant | Langage | Tourne sur | Rôle | Dossier |
|---|---|---|---|---|
| **`pavois++`** | C++17, sans OpenCV | Chaque Raspberry Pi (service systemd) | Capturer la caméra, détecter ce qui bouge, lire l'IMU, envoyer les taches 2D | [`pavois++/`](../pavois++/) |
| **`vps`** | TypeScript, NestJS 11 | Le VPS (conteneur Docker) | Recevoir l'UDP, fusionner en 3D, suivre, classer, alerter, diffuser | [`vps/`](../vps/) |
| **`frontend-angular`** | TypeScript, Angular 22 | Le navigateur, servi par nginx | Carte, pistes, alertes, réglages, vue 3D du banc | [`frontend-angular/`](../frontend-angular/) |

Autour d'eux gravitent des outils : scripts d'installation et de calibration
(`scripts/`, `calibration/`), modèles 3D des supports (`mounts/`), page de
contrôle des Pi (`pi/`) et film de présentation (`animation/`).

## 🌐 Qui parle à qui, et sur quel port

```mermaid
flowchart LR
    subgraph PI["🍓 Raspberry Pi (×3)"]
        direction TB
        RV["rpicam-vid<br/>(caméra CSI)"] --> DET["pavois_detect<br/>pavois.service"]
        IMU["bno08x_bridge.py<br/>pavois-imu.service"] -- "fichier<br/>/run/pavois-imu/orientation" --> DET
    end

    subgraph VPS["☁️ VPS (Docker Compose)"]
        direction TB
        NG["nginx + Angular<br/>frontend-angular"]
        API["NestJS<br/>vps-server"]
        DATA[("volume data/<br/>JSONL + JSON")]
        NG -- "/api/* → :3002<br/>/ws → :3002" --> API
        API --- DATA
    end

    OP["🧑‍✈️ Navigateur<br/>de l'opérateur"]
    DIS["💬 Discord"]

    DET -- "UDP 41234<br/>raw · att · stats · cfg" --> API
    API -. "UDP retour<br/>set · capture" .-> DET
    DET -- "HTTP POST<br/>/api/preview<br/>/api/classification/capture" --> NG
    OP -- "HTTP /api + WS /ws<br/>(jeton opérateur)" --> NG
    API -- "HTTPS webhook" --> DIS
```

| Flux | Protocole | Port (prod / staging) | Authentification |
|---|---|---|---|
| Pi → VPS : détections, cap, stats, réglages appliqués | UDP | `41234` / `41234` et `41235` | HMAC-SHA256 (voir [Sécurité](11-securite.md)) |
| VPS → Pi : nouveaux réglages, demande de photo | UDP, vers le port source du Pi | — | HMAC-SHA256 |
| Pi → VPS : aperçu JPEG, photo de la cible | HTTP via nginx | `8080` / `8081` | aucune (voir [limites](11-securite.md#-ce-qui-nest-pas-encore-protégé)) |
| Navigateur → interface | HTTP | `8080` / `8081` | — |
| Navigateur → API | HTTP `/api/…` via nginx | `8080` / `8081` | `Authorization: Bearer <jeton>` |
| Navigateur → temps réel | WebSocket `/ws` via nginx | `8080` / `8081` | `?token=` ou cookie |
| API directe (debug) | HTTP + WebSocket | `3002` / `3003` | jeton opérateur |
| VPS → Discord | HTTPS | 443 | URL secrète du webhook |

> [!NOTE]
> Le VPS renvoie les commandes **vers l'adresse et le port d'où viennent les
> paquets du Pi**. Le Pi n'a donc aucun port entrant à ouvrir : c'est sa propre
> socket d'émission qui reçoit la réponse.

## 🚀 Le voyage d'une détection

Du photon à l'écran, voici ce qui se passe quand un drone traverse le champ.

```mermaid
sequenceDiagram
    autonumber
    participant Cam as 📷 rpicam-vid
    participant Det as pavois_detect (Pi)
    participant Udp as UdpService (VPS)
    participant Fus as FusionService
    participant Trk as TracksService<br/>+ AlertsService
    participant WS as EventsGateway
    participant UI as 🖥️ Angular

    Cam->>Det: image + heure de capture (FrameWallClock)
    Det->>Det: fond, seuil, taches, confirmation 2 sur 3
    Det->>Udp: raw,jean,frame,t_us,x,y,taille,qualité,cap,… (signé HMAC)
    Udp->>Udp: vérifie la signature et la fraîcheur
    Udp->>Fus: ingest(observation + pose de la caméra)
    Udp-->>WS: raw_detection
    WS-->>UI: rayon fugace sur la carte
    Note over Fus: un tick toutes les 33 ms,<br/>quand les 3 caméras ont parlé<br/>(ou après 80 ms d'attente)
    Fus->>Fus: aligner → associer → trianguler → Kalman
    Fus-->>Udp: pistes du tick
    Udp-->>WS: fuse_update (≤ 1 toutes les 50 ms)
    Udp->>Trk: enregistrer la position, évaluer l'alerte
    Udp-->>WS: track_update (lat, lng, alt, classe)
    Trk-->>WS: alert / alert_updated
    WS-->>UI: icône de piste, traînée, alerte
```

Chaque étape est détaillée dans sa page : [détection](03-detecteur-pi.md),
[fusion](04-fusion-3d.md), [serveur](05-serveur-vps.md),
[interface](06-interface-operateur.md), [messages](07-protocoles.md).

## 🔁 Les deux boucles de retour

Le VPS ne fait pas qu'écouter. Il pilote aussi les Pi par deux boucles.

```mermaid
flowchart TB
    subgraph R["🎛️ Réglages à chaud"]
        direction LR
        R1["L'opérateur<br/>bouge un curseur"] --> R2["VPS :<br/>PUT /tuning/detector"]
        R2 --> R3["UDP<br/>set,cam,version,…"]
        R3 --> R4["Le Pi applique<br/>et annonce cfg,…"]
        R4 --> R5{"version<br/>= voulue ?"}
        R5 -- non --> R3
        R5 -- oui --> R6["tuning_state<br/>→ panneau à jour"]
    end
    subgraph P["📸 Photos de la cible"]
        direction LR
        P1["Point fusionné<br/>à moins de 8 m de l'origine<br/>et 3 caméras en ligne"] --> P2["UDP<br/>capture,cam,id,expire"]
        P2 --> P3["Chaque Pi poste<br/>une image pleine<br/>résolution en HTTP"]
        P3 --> P4["OpenCV examine<br/>chaque vue"]
        P4 --> P5["Vote 2 sur 3<br/>→ target_classification"]
    end
```

- **Réglages** : la commande est renvoyée chaque seconde tant que le Pi
  n'annonce pas la bonne version. Une commande perdue ou un Pi qui redémarre se
  rattrapent seuls. Voir [Le serveur VPS](05-serveur-vps.md#-réglages-à-chaud).
- **Photos** : un épisode par passage de cible. Voir
  [Le serveur VPS](05-serveur-vps.md#-classification-par-photos).

## 📂 Le dépôt en un coup d'œil

```text
Pavois/
├── pavois++/            Détecteur C++ des Pi (CMake, tests, outils, fichiers systemd)
├── vps/                 Backend NestJS (un dossier par fonctionnalité) + classifieur Python
├── frontend-angular/    Interface opérateur (Angular, Leaflet, three.js) + serveur mock
├── scripts/             Installation des Pi, déploiement, durcissement, calibration, banc de rejeu
├── calibration/         Mires ChArUco et damier, script de calibration hors ligne
├── mounts/              Supports caméra et banc rail V5 (OpenSCAD, STL, 3MF)
├── pi/                  Page web de contrôle caméra + IMU, flux MJPEG (outils de banc)
├── animation/           Film de présentation Blender (V1, V2, V3)
├── documentation/       ← tu es ici
├── docker-compose.yml           Pile « production » : interface 8080, API 3002
├── docker-compose.staging.yml   Pile « staging » : interface 8081, API 3003
└── .github/workflows/   Déploiement des Pi, déploiement du VPS, analyses de sécurité
```

## 🧭 Les décisions d'architecture

Chaque décision ci-dessous est en vigueur dans le code. Elle explique *pourquoi*
le système a cette forme.

### D1 — La fusion 3D tourne sur le VPS *(11 septembre 2026, SCRUM-56)*

| | |
|---|---|
| **Question** | Où croiser les rayons des trois caméras ? |
| **Options** | ① sur le VPS ; ② sur une Pi « maîtresse » ; ③ dans un binaire C++ à côté du VPS |
| **Décision** | **① le VPS.** Il reçoit déjà les trois flux et parle déjà à l'écran. |
| **Pourquoi** | Chemin le plus court vers l'écran ; une Pi en panne laisse deux caméras utiles (avec ②, la perte de la maîtresse coupe toute la 3D) ; un service de moins à maintenir qu'avec ③. |
| **Prix payé** | La triangulation et le Kalman de `pavois++` ont été **portés en TypeScript** (`vps/src/fusion/`). Le C++ garde sa propre fusion pour les tests et le mode multi-caméras local. |

### D2 — Une caméra par Pi, la Pi n'envoie que du 2D

Quand un seul flux est activé dans la configuration, `pavois_detect` émet une
ligne `raw` par tache confirmée (`pavois++/src/runtime/camera_worker.cpp`). Sa
fusion interne n'a alors qu'une caméra et ne produit rien. Les lignes `obj…`
(pistes 3D déjà fusionnées) n'apparaissent qu'en mode multi-caméras local,
utile pour les scènes synthétiques.

### D3 — UDP pour la télémétrie, renvoi pour les commandes

Une détection perdue est remplacée par la suivante 33 ms plus tard : un
protocole sans connexion suffit et ne bloque jamais la capture. Ce qui doit
arriver (les réglages) est **renvoyé jusqu'à confirmation** au lieu de compter
sur le transport. Chaque datagramme est signé et daté (HMAC + fenêtre anti-rejeu).

### D4 — Pas de base de données

Alertes, pistes et changements d'état des caméras vivent **en mémoire** et sont
écrits en **JSONL** (une ligne JSON par événement) dans `data/`. Le service
continue à tourner si le disque sature, il n'y a ni port de base à exposer ni
migration à gérer. Le stockage passe par une interface
(`alert-store.interface.ts`, `track-store.interface.ts`) : on peut le remplacer
sans toucher aux services. L'ancien Postgres a été retiré le 4 octobre 2026.

### D5 — Pas d'OpenCV sur la Pi

`pavois++` fait sa propre algèbre, ses opérations d'image et l'encodage JPEG de
ses aperçus. Le binaire reste petit, se compile sur la Pi et ne se lie qu'aux
threads et à la partie crypto d'OpenSSL (signature HMAC). À l'exécution, il
pilote `rpicam-vid` et `ffmpeg` comme processus séparés pour obtenir les images.
OpenCV n'apparaît que côté outils : calibration
(`scripts/pavois_camera_calib.py`) et classifieur de photos sur le VPS
(`vps/classifier/classify_target.py`).

### D6 — Une seule table des réglages

Les réglages modifiables à chaud sont décrits **une fois** dans
`vps/src/tuning/tuning.params.ts` : bornes, pas, libellés, aide. L'API s'en sert
pour valider, le frontend la reçoit telle quelle pour dessiner ses curseurs. Côté
Pi, `pavois++/src/config/live_tuning.cpp` reprend les mêmes clés et bornes et
borne lui-même ce qu'il reçoit.

---

[← Découvrir PAVOIS](01-decouvrir-pavois.md) · [🏠 Accueil](README.md) · [Le détecteur sur les Pi →](03-detecteur-pi.md)
