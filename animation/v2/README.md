# PAVOIS — prototype du film V2.1

Maquette 3D de **55 secondes**, **24 images/s**, sans son. Le montage suit le scénario V2.1 : vol rapproché, insert objectif, premier capteur, deux inserts caméra, trois champs de vision, opérateur, écran, raccord carte/terrain, vol latéral, plan dans l’axe, contrechamp et révélation de 36 capteurs, signature.

## Ouvrir et regarder

- `output/pavois_film_v2.mp4` : film complet à 640 × 360, 24 images/s. Résolution volontairement légère pour juger les plans.
- `output/pavois_film_v2.blend` : scène modifiable, autonome, avec 15 caméras de réalisation et les coupes liées aux marqueurs de timeline. Elle s’ouvre sur les trois champs de vision ; revenir à l’image 1 et appuyer sur Espace pour lire le montage.
- `output/edit.json` : début et fin de chacun des 15 plans.
- `output/verification.json` : contrôles de continuité du montage, cadrage du drone, raccord carte/drone et réseau final.
- `output/storyboard.jpg` : planche d’images extraites du film.

Les modèles sont des volumes de blocage : drone, capteurs, bâtiments, personnage mannequin, PC. La priorité est la composition et le rythme. Il n’y a pas de simulation aérodynamique ni de détection exécutée. Les trois vignettes du PC utilisent les projections des trois caméras virtuelles sur le même drone animé ; elles sont représentées par des silhouettes vectorielles, pas par trois vidéos photoréalistes. La carte réutilise les coordonnées du site.

Le bref insert de carte (33–34 s) prépare le raccord vers la vue plongeante. C’est un plan supplémentaire à l’intérieur de la séquence écran du scénario. Le dernier recul est le grand mouvement de révélation ; les autres changements d’échelle reposent sur des coupes.

## Générer à nouveau

Depuis la racine du dépôt :

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --python animation/v2/build_film.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background animation/v2/output/pavois_film_v2.blend --python animation/v2/verify_edit.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background animation/v2/output/pavois_film_v2.blend --python animation/v2/render_preview.py
python animation/v2/encode_film.py
python animation/v2/make_storyboard.py
```

Blender 5.2 a été utilisé. Le rendu est en EEVEE, avec matériaux de champs de vision transparents. Le `.blend` conserve une résolution de travail de 960 × 540. Le script de prévisualisation produit 1 320 PNG en 640 × 360, puis FFmpeg les assemble sans piste audio.

Le rendu peut reprendre : il ignore les PNG déjà présents. Après une modification du montage ou des objets, déplacer l’ancien dossier `output/film_frames` avant de relancer pour éviter de mélanger des versions. La génération remplace le `.blend` V2 ; enregistrer les modifications manuelles sous un autre nom pour les conserver. La V1 reste dans `animation/output`.

## Modifier

Dans `build_film.py`, les appels `shot(...)` définissent les coupes et les poses de caméra. `target(frame)` définit la trajectoire continue. `sensor_pos` définit les 36 capteurs. L’intérieur est construit à l’écart du site pour faciliter les prises de vues ; la coupe le représente comme le poste opérateur du bâtiment.

Les animations sont enregistrées en images clés : aucune exécution Python ni extension n’est requise à l’ouverture du fichier. Les annotations restent des objets texte. La version utilise les légendes du scénario et indique « Projection de déploiement » sur la révélation du réseau.
