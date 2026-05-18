# Expériences et validation

Ce fichier décrit comment valider PAVOIS de façon scientifique et quelles
métriques publier dans un article.

## Hypothèses à tester

1. Les pixels en mouvement peuvent être projetés dans une grille voxel comme
   preuve directionnelle.
2. Plusieurs caméras réduisent l'ambiguïté de profondeur en accumulant de la
   preuve au même endroit.
3. La précision dépend de la calibration, de la base entre caméras, de la taille
   voxel, de la distance cible et du bruit image.
4. La performance temps réel dépend surtout de la résolution, du nombre de
   pixels mobiles, du nombre de rayons, de la taille de grille et du matériel
   CPU/GPU.

## Expérience 1 : test monocaméra

Objectif :

Vérifier qu'un objet en mouvement produit une structure en forme de rayon dans
la grille voxel.

Configuration :

- Une webcam.
- Position et orientation caméra connues.
- Objet mobile traversant le champ de vision.
- Utilisation de `capture_single_camera.py` ou `realtime_voxel_preview.py`.

Résultat attendu :

- Une seule caméra ne doit pas produire une cible 3D compacte.
- La preuve doit s'étendre dans la direction du rayon.

À publier :

- Image avec masque de mouvement.
- Projections voxel XY, XZ et YZ.
- Seuil de mouvement.
- Taille de grille et taille voxel.
- Temps de calcul.

## Expérience 2 : localisation avec deux caméras

Objectif :

Montrer que deux caméras localisent mieux qu'une seule.

Configuration :

- Deux caméras calibrées.
- Distance entre caméras mesurée.
- Repère ENU commun.
- Cible avec position de référence.
- Images synchronisées autant que possible.

Métrique principale :

```text
erreur_position = ||p_estime - p_reference||
```

À publier :

- Erreur moyenne.
- Erreur médiane.
- 95e percentile.
- Erreur selon la distance cible.
- Erreur selon la base entre caméras.
- Erreur selon la taille voxel.

## Expérience 3 : sensibilité au seuil et au bruit

Objectif :

Comprendre l'effet des paramètres de détection de mouvement.

Paramètres à varier :

- Seuil de mouvement.
- Flou gaussien.
- Filtre médian.
- Ouverture et fermeture morphologiques.
- Taille minimale de composante.
- Soustraction de fond MOG2.
- Sous-échantillonnage par `motion-stride`.

Métriques :

- Rappel.
- Taux de faux positifs.
- Nombre de rayons candidats par image.
- FPS.

## Expérience 4 : performance

Objectif :

Mesurer si le système peut fonctionner en temps réel.

Paramètres à varier :

- Résolution : 640x480, 1280x720, 1920x1080.
- `--max-rays`.
- `--ray-steps`.
- `--grid-n`.
- CPU contre CUDA.
- `--motion-scale`.
- `--voxel-viz-every`.

À publier :

```text
fps
rayons candidats par image
rayons acceptés après intersection AABB
échantillons voxel par image
mémoire utilisée
latence moyenne
```

## Expérience 5 : mouvements parasites

Objectif :

Mesurer le comportement du système face à des objets non-drones.

Cas à tester :

- Arbres ou drapeaux dans le vent.
- Ombres et changements de lumière.
- Oiseaux.
- Voitures ou personnes en arrière-plan.
- Vibration de caméra.
- Bruit de compression.

À publier :

- Fausses alertes par minute.
- Apparence des motifs voxel.
- Filtres qui réduisent le bruit.
- Filtres qui suppriment aussi de petites vraies cibles.

## Vérité terrain

Sources possibles :

- Positions fixes mesurées.
- GPS RTK ou logs de télémétrie drone si disponibles.
- Caméra de référence calibrée.
- Annotations manuelles.
- Données synthétiques Blender.

L'article doit préciser l'incertitude de la vérité terrain.

## Métriques de détection

```text
precision = TP / (TP + FP)
recall    = TP / (TP + FN)
F1        = 2 * precision * recall / (precision + recall)
```

## Métriques de localisation

```text
erreur_moyenne_m
erreur_mediane_m
erreur_p95_m
erreur_x_m
erreur_y_m
erreur_z_m
```

## Métriques de performance

```text
fps
latence_ms
temps_update_voxel_ms
temps_rendu_ms
memoire_mb
```

## Métriques de suivi futures

```text
fragmentation_de_piste
changements_ID
temps_confirmation_s
taux_perte_piste
```

## Bases de comparaison

Comparer avec :

- Une seule caméra.
- Triangulation stéréo classique avec détections appariées.
- Masque brut contre masque débruité.
- CPU contre GPU.
- Plusieurs tailles voxel.
- Plusieurs distances et bases de caméras.

## Niveau minimal pour un article crédible

Un article technique sérieux devrait contenir au minimum :

- Un test réel avec deux caméras.
- Des détails de calibration.
- Un tableau d'erreur de localisation.
- Un tableau de performance.
- Des images de projections voxel.
- Une section de limites explicite.

