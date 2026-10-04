# P.A.V.O.I.S.

Système de détection de drones par vision multi-caméras : chaque Raspberry Pi
détecte et fusionne localement, le VPS agrège les flux et les diffuse en
temps réel vers une interface cartographique.

Trois composants :

| Composant | Rôle | Répertoire |
|---|---|---|
| `pavois++` | Détecteur C++ embarqué sur chaque Pi (capture caméra, détection, fusion, envoi UDP) | [pavois++/](pavois++/) |
| `vps` | Backend NestJS : ingestion UDP, fusion multi-caméras, diffusion WebSocket, API HTTP | [vps/](vps/) |
| `frontend-angular` | Interface opérateur (carte, pistes, alertes) | [frontend-angular/](frontend-angular/) |

## Lancer `pavois++` (détecteur, sur une Pi ou en local pour tester)

```bash
cd pavois++
cmake -S . -B build
cmake --build build
./build/pavois_detect --config pavois++.conf
```

Sans caméra disponible, rejouer une scène synthétique :

```bash
./build/pavois_gen_scene /tmp/scene 300
./build/pavois_detect --config /tmp/scene/scene.conf --frames 300
```

Détails complets (déploiement Pi, systemd, calibration IMU, mode GPS,
caméras RTSP) : [pavois++/README.md](pavois++/README.md) et
[pavois++/DEPLOYMENT_PI.md](pavois++/DEPLOYMENT_PI.md).

### Rejouer une session enregistrée dans toute la chaîne

`scripts/pavois_replay_bench.sh` monte le banc complet sur un seul poste : un
`pavois_detect` par caméra rejouant les images enregistrées sur leur horloge de
capture d'origine, le `vps` qui fusionne, et le frontend qui affiche les pistes
et la vidéo. Aucune Pi n'est sollicitée et rien n'est déployé.

```bash
scripts/pavois_replay_bench.sh --recording /chemin/rec-AAAAMMJJ-HHMMSSZ-auto
```

Voir `--help` pour les options (fenêtre temporelle, résolution, sans frontend).

### Classifieur de pistes (pattern matching)

Deux scripts transforment des sessions enregistrées en jeu de données puis en
modèle. `vps/src/fusion/fusion-classify.ts` reste l'heuristique par seuils ; ce modèle
apprend les mêmes entrées à partir de vols réels.

```bash
# 1. vols -> tableur (ajoute des exemples oiseau/avion générés)
scripts/pavois_extract_features.py /chemin/rec-... --label drone \
    --synth-birds 120 --synth-airplanes 120 --out dataset.xlsx

# 2. tableur -> modèle
scripts/pavois_train_classifier.py dataset.xlsx --out model.joblib

# 3. plus tard : ajouter une session puis réentraîner
scripts/pavois_extract_features.py /chemin/nouveau-rec --label drone \
    --append --out dataset.xlsx
scripts/pavois_train_classifier.py dataset.xlsx --out model.joblib
```

Les colonnes d'entraînement sont sans échelle (vitesses angulaires, fraction de
vol stationnaire, rectitude, dynamique de silhouette) : elles restent valables
tant que les extrinsèques du banc ne sont pas calibrées. `altitude_m` et
`speed_mps` sont écrites pour lecture mais **exclues de l'entraînement**.

## Lancer `vps` (backend)

```bash
cd vps
cp .env.example .env   # renseigner au minimum WS_AUTH_TOKEN (pas de valeur par défaut)
npm install
npm run start:dev
```

Écoute UDP sur le port `UDP_PORT` (défaut `41234`) et sert l'API/WebSocket
sur `PORT` (défaut `3002`).

## Lancer `frontend-angular` (interface)

```bash
cd frontend-angular
npm install
npm start               # ng serve, se connecte au vps réel
```

Sans backend disponible, utiliser le serveur mock à la place :

```bash
npm run mock:ws         # sert des données WebSocket simulées
npm run start:mock      # dans un second terminal, ng serve en configuration mock
```

## Déploiement VPS (Docker Compose)

Voir [DEPLOYMENT.md](DEPLOYMENT.md) pour lancer `vps` et `frontend-angular`
via Docker Compose sur un serveur.

## Documentation

Le dossier [documentation/](documentation/) contient la documentation
scientifique et technique du projet (modèle mathématique, algorithmes,
architecture, formats de données, limites connues) — voir
[documentation/README.md](documentation/README.md) pour l'ordre de lecture
conseillé. L'intégration UDP → WebSocket est détaillée dans
[documentation/udp-integration.md](documentation/udp-integration.md).
