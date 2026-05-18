# Guide pour l'article scientifique

Ce fichier explique comment rédiger un article scientifique ou technique sur
PAVOIS. L'objectif n'est pas seulement de présenter le projet, mais de permettre
à un autre scientifique ou développeur de comprendre, critiquer et reproduire la
méthode.

## Titre possible

PAVOIS : fusion optique pixel-vers-voxel pour la localisation de petits objets
aériens par caméras distribuées

## Résumé

Le résumé doit tenir en un paragraphe et couvrir :

- Le problème : localiser des petits drones à basse altitude avec des caméras
  optiques.
- L'approche : détecter les pixels en mouvement, les rétro-projeter en rayons
  3D, puis fusionner ces rayons dans une grille voxel commune.
- La contribution : un pipeline logiciel, une prévisualisation temps réel et une
  interface opérateur pour la couverture, les pistes, les alertes et le replay.
- L'évaluation : tests réels ou synthétiques mesurant l'erreur de localisation,
  la latence, les faux positifs et la performance.
- La limite principale : le prototype démontre le mécanisme central, mais la
  calibration robuste, la classification et le suivi multi-cibles restent à
  valider.

## Structure recommandée

### 1. Introduction

Présenter le besoin : détection et localisation de petits drones dans un espace
local. Expliquer pourquoi l'optique est intéressante : capteur passif, coût
modéré, résolution élevée, données facilement interprétables.

Il faut aussi expliquer la difficulté : une caméra seule donne surtout une
direction d'observation. Elle ne donne pas une profondeur fiable.

Phrase centrale possible :

```text
PAVOIS transforme le mouvement apparent dans plusieurs images en une preuve 3D
partagée : chaque pixel en mouvement génère un rayon, et les régions où plusieurs
rayons convergent deviennent des candidats de localisation.
```

### 2. Travaux liés

Comparer avec :

- Géométrie multi-vues et triangulation.
- Détection de mouvement et soustraction de fond.
- Grilles d'occupation et volumes voxel.
- Suivi multi-cibles, filtres de Kalman et association de mesures.
- Détection de drones par radar, radiofréquence, acoustique, thermique et
  optique.

### 3. Vue d'ensemble du système

Décrire le pipeline :

```text
Images caméra
  -> prétraitement en niveaux de gris
  -> détection de mouvement temporelle
  -> génération de rayons par pixel
  -> intersection rayon-boîte
  -> accumulation dans une grille voxel
  -> extraction de clusters
  -> suivi de cible
  -> visualisation opérateur
```

Dans l'article final, ajouter un schéma de cette chaîne.

### 4. Modèle mathématique

Oui, il faut parler de mathématiques. Sans mathématiques, un scientifique ne
peut pas vérifier si la méthode est cohérente.

Inclure au minimum :

- Le repère utilisé et les unités.
- La projection d'un pixel vers un rayon caméra.
- La rotation du repère caméra vers le repère monde.
- L'équation du rayon.
- La définition de la grille voxel.
- L'intersection rayon-boîte.
- La règle d'accumulation de preuve.
- Le modèle de confiance et le modèle de suivi, au moins comme travail futur.

Le fichier [Modèle mathématique](mathematical-model.md) contient les équations à
reprendre.

### 5. Méthodes et algorithmes

Décrire en pseudo-code :

- La détection de mouvement entre deux images.
- La génération d'un rayon pour chaque pixel changé.
- Le parcours voxel par DDA.
- L'accumulation des scores.
- L'extraction de clusters, une fois implémentée.
- La mise à jour des pistes, une fois le suivi implémenté.

### 6. Implémentation

Documenter le code réel :

- `pixeltovoxelprojector/ray_voxel.cpp` : pipeline C++ par lot.
- `pixeltovoxelprojector/realtime_voxel_preview.py` : prévisualisation
  OpenCV/PyTorch en direct.
- `pixeltovoxelprojector/capture_single_camera.py` : capture d'images et
  génération de métadonnées.
- `frontend/src/sim/pavoisSim.ts` : simulation des caméras, pistes et alertes.
- `frontend/src/components/MapViewer.tsx` : visualisation Cesium.
- `frontend/src/components/IsometricMap.tsx` : vue tactique canvas.

Il faut séparer clairement ce qui existe aujourd'hui de ce qui est prévu.

### 7. Expériences

Un article crédible doit mesurer le système.

Expériences recommandées :

- Test monocaméra : vérifier qu'un objet en mouvement produit une trace de rayon
  dans le volume voxel.
- Test deux caméras : mesurer l'erreur de localisation avec une base connue.
- Sensibilité : faire varier seuil de mouvement, champ de vision, taille voxel,
  distance cible et séparation des caméras.
- Performance : mesurer le FPS selon résolution, nombre de rayons, taille de
  grille et exécution CPU/GPU.
- Faux positifs : tester oiseaux, arbres, ombres, bruit de compression et
  vibration de caméra.

### 8. Résultats

Publier des tableaux :

```text
erreur moyenne de localisation : mètres
erreur médiane : mètres
95e percentile : mètres
latence de détection : millisecondes
taux de faux positifs : alertes par minute
rappel : images drone détectées / images drone visibles
performance : fps
mémoire : MB
```

Inclure aussi des figures :

- Image caméra avec masque de mouvement.
- Projections voxel XY, XZ et YZ.
- Carte 3D avec caméras et piste.
- Erreur en fonction de la distance.
- FPS en fonction du nombre de rayons.

### 9. Discussion

Expliquer les réussites et les échecs :

- Une plus grande base entre caméras améliore la triangulation.
- Une taille voxel plus petite améliore la résolution mais augmente la mémoire.
- Un seuil de mouvement faible augmente la sensibilité mais aussi le bruit.
- Une seule caméra ne suffit pas à localiser précisément en profondeur.
- La couverture commune de plusieurs caméras est essentielle.

### 10. Limites

Les limites doivent être explicites :

- Les erreurs de calibration peuvent dominer l'erreur finale.
- La différence d'images est sensible aux changements de lumière.
- L'atténuation avec la distance n'est pas encore physiquement correcte dans le
  chemin C++.
- L'interface actuelle utilise une simulation ; elle n'est pas encore alimentée
  par un flux de pistes réel.
- La classification drone/oiseau n'est pas encore implémentée.

### 11. Conclusion

Conclusion prudente possible :

```text
PAVOIS démontre une méthode logicielle pour transformer des mouvements optiques
en preuve 3D dans une grille voxel commune. Le prototype valide le mécanisme de
projection pixel-vers-voxel et fournit une interface de visualisation, tout en
laissant la calibration, le suivi, la classification et la validation terrain
comme travaux futurs.
```

