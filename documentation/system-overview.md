# Vue d'ensemble du système

PAVOIS est un prototype de détection et de localisation d'objets aériens à basse
altitude par caméras optiques. L'idée centrale est de convertir le mouvement 2D
dans les images en preuve 3D.

## Principe

Un pixel en mouvement dans une image caméra ne donne pas directement la
profondeur. Il définit un rayon : tout point 3D situé sur ce rayon pourrait être
responsable du pixel observé. Avec une seule caméra, la profondeur reste
ambiguë. Avec deux caméras ou plus, les rayons associés au même objet se croisent
ou passent près d'une même région. PAVOIS accumule cette preuve dans une grille
voxel partagée.

```text
mouvement dans l'image
  -> rayon issu d'un pixel
  -> rayon dans le repère monde
  -> parcours de la grille voxel
  -> accumulation de preuve 3D
  -> cluster candidat
  -> piste et alerte
```

## Sous-systèmes principaux

### Prototype de détection optique

Emplacement : `pixeltovoxelprojector/`

Rôles :

- Capturer des images caméra.
- Convertir les images en niveaux de gris.
- Détecter les pixels en mouvement par différence temporelle.
- Convertir les pixels changés en rayons caméra.
- Transformer les rayons dans un repère monde.
- Parcourir une grille voxel et accumuler la preuve.
- Sauvegarder ou visualiser le volume voxel.

Fichiers importants :

- `capture_single_camera.py` : capture des images et écrit `metadata.json`.
- `ray_voxel.cpp` : pipeline C++ de différence d'images et d'accumulation voxel.
- `realtime_voxel_preview.py` : prévisualisation en direct avec masque de
  mouvement et projections voxel.
- `voxelmotionviewer.py` : visualisation des grilles voxel sauvegardées.
- `camera_backend.py` et `camera_preprocess.py` : ouverture caméra et
  prétraitement.

### Interface opérateur

Emplacement : `frontend/`

Rôles :

- Afficher les positions de caméras et leurs couvertures.
- Afficher des pistes simulées, vecteurs de vitesse, prédictions et alertes.
- Fournir des vues surveillance, déploiement et replay.
- Visualiser le scénario dans Cesium et dans une vue isométrique canvas.

Fichiers importants :

- `frontend/src/App.tsx` : structure générale de l'application.
- `frontend/src/sim/pavoisSim.ts` : données de simulation et fonctions d'aide.
- `frontend/src/components/MapViewer.tsx` : visualisation Cesium.
- `frontend/src/components/IsometricMap.tsx` : carte tactique canvas.
- `frontend/src/components/DeploymentView.tsx` : synthèse couverture/caméras.
- `frontend/src/components/ReplayView.tsx` : replay événementiel.

## Flux de données actuel

Le prototype de détection et l'interface ne sont pas encore connectés par un
backend réel.

```text
Chemin de détection implémenté :

caméra USB ou séquence d'images
  -> détection de mouvement Python/C++
  -> accumulation dans une grille voxel
  -> fichier binaire ou fenêtre de prévisualisation

Chemin frontend implémenté :

données de simulation statiques
  -> état Zustand
  -> visualisation Cesium/canvas
  -> alertes et replay

Chemin intégré futur :

moteur de détection
  -> extraction de clusters
  -> gestionnaire de pistes
  -> API backend / WebSocket
  -> carte et panneaux d'alerte
```

## Convention de coordonnées

Le prototype voxel utilise un repère local de type ENU :

```text
X = Est
Y = Nord / avant
Z = Haut
```

Avec la convention actuelle, une caméra configurée comme suit pointe vers `+Y` :

```text
yaw = 0 deg
pitch = 90 deg
roll = 0 deg
```

Le frontend utilise une grille de simulation 24 par 24 projetée autour de Los
Angeles pour l'affichage Cesium. Cette grille n'est pas encore le même repère que
le repère ENU du prototype voxel. Une intégration réelle doit donc définir une
couche de conversion unique et explicite.

## Partie scientifique du projet

La contribution scientifique vient de la relation mesurable entre :

- le mouvement apparent dans les images ;
- la géométrie caméra ;
- l'accumulation voxel ;
- la convergence multi-caméras ;
- l'erreur finale de localisation.

Un article doit donc expliquer la géométrie, les équations, les hypothèses et les
sources d'erreur.

