# PAVOIS — scène 3D silencieuse

> Première animatique V1. Le prototype du film suivant le montage V2.1 (55 secondes, opérateur, écran et réseau étendu) se trouve dans [v2/README.md](v2/README.md).

Ouvrir `output/pavois_intro.blend` dans Blender, puis lire la timeline avec Espace. Le fichier s’ouvre sur la convergence des trois observations (image 450). Revenir à l’image 1 pour voir l’introduction.

32 secondes, 24 images/s, images 1–768. Aucun son ni voix off. Quatre plans : observation optique, profondeur ambiguë avec un seul rayon, convergence multi-caméras, suivi d’une trajectoire. Les titres sont des objets texte éditables. Les caméras et le drone sont des modèles stylisés créés pour l’animatique, pas des répliques du matériel réel.

## Fichiers

- `build_scene.py` : génération reproductible de la scène et des animations.
- `output/pavois_intro.blend` : scène autonome ; ni script à autoriser ni extension nécessaire à la lecture.
- `output/pavois_animatic.mp4` : aperçu silencieux de mouvement, rendu solide à 640 × 360 et 12 images/s, durée conservée.
- `output/preview_*.png` : quatre rendus Cycles à 960 × 540 pour vérifier les matériaux et la composition.

Le rendu vidéo solide sert à examiner le rythme et la caméra. Les PNG montrent les matériaux du fichier Blender. Aucun rendu final haute définition de toute l’animation n’est livré à cette étape.

## Regénérer

Depuis la racine du dépôt, avec Blender 5.2 :

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --python animation/build_scene.py -- --stills --preview
python animation/encode_preview.py
```

Sans les options `--stills --preview`, le script crée uniquement le fichier Blender. Il remplace son propre résultat `output/pavois_intro.blend` ; conserver sous un autre nom une scène modifiée à la main avant de régénérer.

Les réglages de rendu sauvegardés sont Cycles, 1280 × 720, 24 échantillons avec débruitage et sortie en séquence PNG. Augmenter résolution et échantillonnage pour un rendu final. La scène de travail s’ouvre à l’image 450 mais la plage de rendu reste 1–768.

## Modifier la mise en scène

Dans le script, `shots` rassemble les positions de départ/arrivée de la caméra, les points visés et les focales. `target(frame)` définit le parcours du drone avec un arrêt pédagogique pendant l’explication. `origins` contient les centres optiques réels des modèles ; chaque rayon relie son centre optique à la même cible au même instant.

Les groupes de noms `SENSOR`, `TARGET`, `GEOMETRY`, `TRACK`, `DIRECTOR` et `TITLES` permettent de retrouver les objets dans l’Outliner. Les quatre plans sont repérés dans la timeline.

Il s’agit d’une illustration de triangulation, pas d’une exécution du moteur de détection. Les sphères sur le premier rayon représentent des profondeurs possibles. Le volume autour du drone représente une région estimée de manière graphique, pas une mesure d’incertitude. La présentation Figma reste non consultée en raison du quota du connecteur ; la palette vient du frontend Angular.
