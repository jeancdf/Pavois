# Résumé Global du Projet PAVOIS

Ce document propose une synthèse complète de l'ensemble des fichiers de documentation (`.md`) présents dans le projet **PAVOIS** (Projection Avancée de Voxels pour l’Observation et l’Identification de Signatures). Il est structuré pour permettre une compréhension rapide des objectifs, de l'architecture, du modèle mathématique et de la feuille de route du projet.

---

## 1. Présentation du Projet et Objectifs

### Qu'est-ce que PAVOIS ?
PAVOIS est un système de **détection, de localisation et de suivi optique passif 3D d'objets volants à basse altitude** (notamment des petits drones de type FPV, quadricoptères commerciaux, aéronefs légers, etc.). 

### Les piliers du projet :
- **Détection passive** : Contrairement aux radars, le système n'émet aucun signal électromagnétique, ce qui le rend furtif (invisible pour l'adversaire) et résilient face aux contre-mesures radio.
- **Triangulation multi-caméras** : Plusieurs caméras observent simultanément le ciel. Le mouvement 2D détecté dans chaque flux vidéo est projeté sous forme de rayons dans un repère 3D commun. Le croisement des rayons de plusieurs caméras permet de situer l'objet précisément en 3D.
- **Déploiement tactique et abordable** : Conçu pour être transportable, déployable et calibrable par un opérateur non spécialiste en moins de **3 minutes**, sur du matériel sobre énergétiquement (batteries, solaire, mini-PC ou Raspberry Pi).

---

## 2. Architecture Technique et Logicielle

Le projet est divisé en deux parties principales qui ont vocation à être reliées par un backend (Django / WebSockets) :

### A. Moteur de Détection Optique (`pixeltovoxelprojector/`)
Il s'agit du cœur de calcul chargé de traiter les flux vidéo et de reconstruire l'espace 3D :
- **Langages** : C++ (pour la performance du tracé de rayons et le traitement d'image) avec interface Python via `pybind11` et parallélisation OpenMP.
- **Principe de calcul initial** : 
  1. Capture d'images et détection des pixels en mouvement (différence d'images consécutives).
  2. Lancement de rayons de mouvement (Ray Casting) dans une grille voxel partagée.
  3. L'algorithme **DDA (Digital Differential Analysis)** parcourt la grille voxel. Les zones de croisement des rayons accumulent un "score de mouvement" élevé, matérialisant la cible 3D.
- **Fichiers clés** :
  - [ray_voxel.cpp](file:///c:/Users/Lucli/drone/Pavois/pixeltovoxelprojector/ray_voxel.cpp) : Cœur de calcul C++ de tracé de rayons DDA.
  - [realtime_voxel_preview.py](file:///c:/Users/Lucli/drone/Pavois/pixeltovoxelprojector/realtime_voxel_preview.py) : Visualisation en temps réel (utilisant une version alternative vectorisée sur GPU avec PyTorch pour l'échantillonnage de rayons).
  - [voxelmotionviewer.py](file:///c:/Users/Lucli/drone/Pavois/pixeltovoxelprojector/voxelmotionviewer.py) : Outil de visualisation PyVista des fichiers de grille voxel `.bin`.

### B. Interface Opérateur (`frontend/`)
Une application Web moderne permettant de visualiser la situation tactique en temps réel :
- **Tech Stack** : Angular 18 (dans la documentation projet, mais implémenté en React / TypeScript / Vite / Zustand dans le dossier `frontend/`), Leaflet.js / Cesium pour la cartographie 3D.
- **Fonctionnalités** :
  - Affichage des caméras, de leurs cônes de champ de vision (FOV) et des zones de recouvrement.
  - Représentation 3D des trajectoires (pistes) de drones détectés, prédictions de trajectoire et alertes.
  - Outils de relecture (Replay) et tableau de bord de santé du système.

---

## 3. Modèle Mathématique de Base

1. **Repère local ENU** (East-North-Up) : 
   - $X = \text{Est}$ (droite), $Y = \text{Nord}$ (face/avant), $Z = \text{Haut}$.
   - Une caméra orientée au nord a les angles : $\text{yaw}=0^\circ$, $\text{pitch}=90^\circ$, $\text{roll}=0^\circ$.
2. **Projection Pixel-vers-Rayon** :
   - Focale en pixels : $f = \frac{W/2}{\tan(\theta/2)}$ où $W$ est la largeur de l'image et $\theta$ le champ de vision horizontal (FOV).
   - Le vecteur direction dans le repère caméra est calculé puis transformé dans le repère monde par la matrice de rotation de la caméra $R$ : $d_{\text{world}} = \text{normalize}(R \cdot d_{\text{cam}})$.
   - Le rayon est défini par : $r(t) = c + t \cdot d_{\text{world}}$.
3. **Triangulation et Grille Voxel** :
   - Les rayons issus de pixels en mouvement ajoutent de la valeur aux voxels qu'ils traversent.
   - Les zones de forte convergence (barycentre des voxels à haut score) indiquent la présence du drone.

---

## 4. Feuille de Route d'Évolution (Le Plan à Long Terme)

La documentation met en évidence un pivot important : **la transition d'un modèle basé sur une grille voxel vers un modèle de triangulation analytique direct** afin de détecter des drones beaucoup plus lointains (>300m) sur du matériel léger (Raspberry Pi).

### Phase 0 — Amélioration Optique (Fait)
- Réduction du champ de vision des caméras de 170° (fisheye) à 90°. Cela permet de "zoomer" sur le ciel pour qu'un drone lointain occupe au moins 1 à 3 pixels (portée théorique d'environ 360m pour 1 pixel avec un capteur 1080p).

### Phase 1 — Détection de Cibles Minuscules (Monocamera)
- Remplacement du filtre de mouvement actuel (qui supprime les petits objets) par :
  1. Un modèle de fond lent pour isoler le ciel.
  2. Un filtre morphologique "Top-Hat" pour faire ressortir les points minuscules.
  3. Un calcul de centroïde sous-pixel pour une précision extrême de direction.

### Phase 2 — Suivi Temporel ("Track-Before-Detect")
- Accumuler le signal faible sur plusieurs images successives pour faire ressortir les trajectoires cohérentes et rejeter le bruit aléatoire (scintillements).

### Phase 3 — Triangulation Analytique 3D (Abandon des Voxels)
- Remplacement de la grille voxel (trop lourde en mémoire et imprécise pour les longues distances) par un calcul d'intersection mathématique direct entre les rayons des caméras (moindres carrés).
- L'écart résiduel entre les rayons sert de filtre anti-faux positifs (un moustique proche d'une caméra ne croisera pas le rayon de la seconde).

### Phase 4 — Optimisation pour Raspberry Pi
- Suppression de PyTorch et des dépendances lourdes.
- Capture native via `libcamera` / `picamera2`.
- Focus du calcul sur des zones d'intérêt (ROI) restreintes autour des cibles.

### Phase 5 — Extensions Futures (Militaire & Multi-Senseurs)
- Intégration de capteurs complémentaires : RF (RTL-SDR à $22 pour intercepter les liaisons de commande), acoustique (rotor) et thermique (FLIR).
- Classification IA (ex: YOLOv8 entraîné sur des données synthétiques Blender) pour discriminer les oiseaux des drones.
- Intégration avec des systèmes de commandement (C2) comme **Anduril Lattice** via des messages XML standardisés Cursor-on-Target (CoT).

---

## 5. Fiches de Synthèse par Fichier Markdown

| Chemin du Fichier | Thématique / Contenu Principal | Points Clés à Retenir |
| :--- | :--- | :--- |
| [PLAN.md](file:///c:/Users/Lucli/drone/Pavois/PLAN.md) | Plan de projet global | Spécifie la pile technologique complète (C++, Python, Django, Angular), les phases matérielles, les formats d'API, les modèles de données PostgreSQL et la feuille de route d'intégration avec Anduril Lattice. |
| [plan-detection-drones.md](file:///c:/Users/Lucli/drone/Pavois/documentation/plan-detection-drones.md) | Plan long terme orienté longue portée | Explique avec pédagogie la transition vers la détection de cibles lointaines (suppression des voxels au profit de la triangulation analytique directe) et le portage sur Raspberry Pi. |
| [system-overview.md](file:///c:/Users/Lucli/drone/Pavois/documentation/system-overview.md) | Vue d'ensemble du système | Présente le flux de données actuel (prototype de détection et frontend encore déconnectés) et la structure globale des dossiers du projet. |
| [businness-summary.md](file:///c:/Users/Lucli/drone/Pavois/documentation/docs/businness-summary.md) | Cadrage fonctionnel et cas d'usage | Analyse des menaces (FPV, DJI, hélicoptères), avantages opérationnels de la détection passive, et cas d'usage civils/militaires (frontières, aéroports, sites SEVESO). |
| [technical-summary.md](file:///c:/Users/Lucli/drone/Pavois/documentation/docs/technical-summary.md) | Spécifications matérielles et coûts | Analyse les coûts d'un nœud (optique, thermique, thermique + IR) estimant un prototype de 12k€ à 30k€ et une portée de 300m à 3km pour l'anti-drone. |
| [mathematical-model.md](file:///c:/Users/Lucli/drone/Pavois/documentation/technical-file/mathematical-model.md) | Modélisation et équations | Regroupe les formules de projection de pixels en rayons, d'intersection de boîte, d'accumulation de voxels et le modèle d'état 3D pour filtre de Kalman. |
| [algorithms.md](file:///c:/Users/Lucli/drone/Pavois/documentation/technical-file/algorithms.md) | Algorithmes détaillés | Décrit l'algorithme C++ DDA, la détection de mouvement OpenCV, et les algorithmes d'accumulation GPU avec PyTorch. |
| [data-formats.md](file:///c:/Users/Lucli/drone/Pavois/documentation/technical-file/data-formats.md) | Formats de fichiers et protocoles | Décrit la structure de `metadata.json` pour la calibration, le format binaire de sortie de la grille voxel `.bin` et les messages Cursor-on-Target (CoT). |
| [implementation-architecture.md](file:///c:/Users/Lucli/drone/Pavois/documentation/technical-file/implementation-architecture.md) | Architecture logicielle concrète | Détaille la structure du code (C++/pybind11, OpenCV, Threads de streaming, API REST et WebSockets). |
| [limitations-roadmap.md](file:///c:/Users/Lucli/drone/Pavois/documentation/technical-file/limitations-roadmap.md) | Limites et perspectives | Liste les défis physiques (résolution de profondeur, faux positifs, occultation) et propose une feuille de route pour le code et l'article scientifique associé. |
| [experiments-validation.md](file:///c:/Users/Lucli/drone/Pavois/documentation/technical-file/experiments-validation.md) | Méthodologie de validation | Propose des scénarios de test (simulation Blender, banc de test fixe à 2 caméras, et tests dynamiques de portée en extérieur). |
| [scientific-paper-guide.md](file:///c:/Users/Lucli/drone/Pavois/documentation/scientific-paper-guide.md) | Guide de rédaction de l'article | Structure type et recommandations pour rédiger le papier académique présentant PAVOIS (méthodologie, équations, résultats). |
| [Analyse_Problematique_PAVOIS.md](file:///c:/Users/Lucli/drone/Pavois/documentation/rapport-veille-cadrage/Analyse_Problematique_PAVOIS.md) | Analyse opérationnelle et de veille | Analyse concurrentielle des systèmes anti-drone et place de PAVOIS (passif, coût maîtrisé, triangulation distribuée) dans l'écosystème actuel. |
| [README.md](file:///c:/Users/Lucli/drone/Pavois/pixeltovoxelprojector/README.md) | Guide du dossier de projection | Explications pour compiler et exécuter le code de projection C++/Python (installation, scripts Blender, commandes de build). |
