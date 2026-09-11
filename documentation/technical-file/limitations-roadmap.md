# Limites et feuille de route

Dernière vérification dans le code : **11 septembre 2026** (scorecard
cinématique SCRUM-70, fusion Kalman, IMU partagée, transport CSV/WS).

Chaque limite ci-dessous doit rester vérifiable dans le dépôt. Les phrases
périmées (frontend sur `pavoisSim.ts`, « pas de flux backend », « pas de
Kalman ») ont été retirées.

## Limites actuelles

### Détection et localisation

- Une seule caméra ne résout pas la profondeur. La triangulation VPS exige
  au moins deux observations alignées dans `FUSION_WINDOW_MS` (90 ms).
- Le détecteur C++ est une différence d’images. Ombres, vibrations et
  arrière-plan mobile restent des sources de faux positifs.
- Les positions GPS des Pi sont encore des valeurs de site, à recaler depuis
  l’UI. jean et tanel sont à ~1 m l’un de l’autre, même cap : la paire peut
  échouer le seuil `fusion_min_parallax_deg=2`.
- Le chemin voxel (`pixeltovoxelprojector/`) n’est pas le pipeline de
  production. La fusion 3D tourne dans `vps/` (alignement, triangulation,
  Kalman).

### IMU et calibration

- Terrain : BNO08x à `0x4a`, lu via `pavois-imu.service` puis fichier. Le
  C++ a aussi un chemin BNO055 I2C (`0x28`/`0x29`). `imu.kind=auto` sans
  `imu.file` ignore le BNO08x.
- Un magnétomètre BNO055 < 2 fige le cap (`valid=0`). Le BNO08x ne
  remonte en général que le niveau mag (`S- G- A- M3`).
- L’outil `pavois_imu_calib` écrit `imu.heading_offset_deg`. La qualité IMU
  arrive jusqu’à l’écran (SCRUM-62).

### Suivi

- Kalman à vitesse constante et cycle tentative / confirmée / côte : **en
  production VPS** (`FusionService`, confirm=3, coast=1,2 s).
- Les identifiants de piste (`objN`) viennent du tracker, plus d’une
  simulation frontend.
- **Classification = heuristique cinématique, pas un réseau de neurones.**
  Décision SCRUM-70 : ne **pas** fusionner `feature/pattern-matching-*`
  (elles patchaient l’ancien `UdpService` et le store React). Le scorecard
  v2 (vitesse, accélération, altitude GPS, taux de cap) est porté dans
  `vps/src/fusion-classify.ts` et appliqué aux pistes Kalman. Première
  mesure → `"other"`. Une classe CSV explicite (6ᵉ champ `obj*`) gagne
  encore sur le chemin UDP local. Les seuils ne sont **pas calibrés** ;
  l’alerte Angular « DRONE confirmé » peut partir sur un faux positif.

### Décision SCRUM-70 (branches pattern-matching)

- **Ne pas merger** `feature/pattern-matching-classification` (v1) ni
  `feature/pattern-matching-v2` telles quelles.
- **Porter** le scorecard v2 dans le tracker Kalman actuel
  (`fusion-classify.ts`), avec l’altitude GPS = origine ENU + z.
- **Supprimer** les deux branches distantes une fois le port sur origin
  — fait : `feature/pattern-matching-classification` et
  `feature/pattern-matching-v2` n’existent plus sur origin.

### Intégration frontend

- Frontend canonique de travail : `frontend-angular/` (Leaflet, signaux).
  Il consomme le VPS en WebSocket : `imu_update`, `raw_detection`,
  `track_update`, `camera_preview`, `camera_positions`.
- `frontend/` (React + Cesium + `pavoisSim.ts`) est encore dans le dépôt
  mais n’est plus le flux opérateur (SCRUM-74).
- Le mock Angular a deux modes (SCRUM-73) : `demo` envoie des pistes
  fictives ; `terrain` n’envoie que `att` + `raw` comme les Pi. **Seul
  `terrain` reflète la production.** En `demo`, une carte pleine de pistes
  ne prouve pas que la fusion marche.
- `GET /fusion` expose `lastFuse` (ok, raison, parallaxe, résidu).
  L’Angular ne l’affiche pas encore : une carte à PISTES 0 n’explique pas
  pourquoi.

### Déploiement

- Les trois Pi se déploient depuis `main`. Le job OVH peut encore échouer
  (clé SSH refusée). Un VPS pas à jour n’a pas Kalman / `track_update`.
- HMAC : le C++ signe si `UDP_HMAC_SECRET` est défini ; le VPS vérifie si
  la même clé est là. `UDP_REQUIRE_HMAC=true` n’est pas le défaut. Un
  secret ou une horloge faux = carte vide.

### Validation scientifique

- Pas d’erreur de localisation chiffrée contre une vérité terrain.
- Pas de taux de faux positifs mesuré sur scènes réelles.
- Pas de benchmark systématique images / seconde.

## Feuille de route prioritaire

### Fait dans le code (ne plus planifier comme du neuf)

- Fusion 3D sur le VPS, pas sur la Pi (SCRUM-56 / 57 / 58).
- Kalman et `track_update` GPS (SCRUM-59 / 60).
- Scorecard cinématique drone / avion / oiseau / other (SCRUM-70).
- Pose caméra collée au `raw` (SCRUM-55).
- Rayons bruts et cônes à portée 60 m (SCRUM-64 / 65).
- Job CI `check` (tests VPS + Angular) avant deploy.

### Encore ouvert

1. **Calibrer le classifieur** — seuils du scorecard sur scènes réelles
   (l’algo est en production VPS, pas validé).
2. **Géométrie du parc** — recaler jean / tanel / walid, baseline utile.
3. **Santé opérateur** — montrer `lastFuse` et un heartbeat par Pi.
4. **HMAC aligné** — même secret Pi / VPS, doc et `UDP_REQUIRE_HMAC`.
5. **Vérité terrain** — deux caméras, cible mesurée, tableau d’erreur.
6. **Hygiène** — frontend unique, README racine, secrets, logs (en cours).

## Ce qu’il ne faut pas prétendre trop tôt

Ne pas affirmer :

- capacité opérationnelle de défense anti-drone ;
- classification validée ;
- suivi multi-cibles fiable en conditions non contrôlées ;
- précision terrain prouvée ;
- que le mock `demo` est le système réel.

Formulation prudente actuelle :

```text
PAVOIS détecte du mouvement sur trois Pi, fusionne les détections 2D sur
le VPS (triangulation + Kalman) et les affiche sur l’interface Angular.
La classification est une heuristique de cinématique, non validée terrain.
Une caméra seule ne donne pas de position 3D. L’erreur métrique n’est pas
encore mesurée.
```
