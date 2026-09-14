# PAVOIS — film Blender V3

Film muet de 55 secondes, 1 320 images à 24 i/s, rendu natif 1920 × 1080. Le montage V2.1 est conservé : quinze plans, inserts courts, raccord de regard, raccord graphique carte/drone, contrechamp et travelling de révélation.

## Livrables

- `output/pavois_film_v3_1080p.mp4` : film H.264, sans piste audio.
- `output/pavois_film_v3.blend` : scène modifiable, caméras et animation pré-calculées, images du moniteur et police incorporées.
- `output/storyboard.jpg` : les quinze plans prélevés dans les images du film.
- `output/edit.json` : limites exactes des plans.
- `output/deployment.json` : implantation et rôles des 36 capteurs.
- `output/verification.json` : contrôle des raccords, cadrages et positions.
- `output/delivery_verification.json` : intégrité des 1 320 PNG et décodage intégral du MP4.

## Raffinement visuel

Paysage vallonné d'un kilomètre de côté, sol à variations procédurales, pins à branches irrégulières instanciés, rochers et herbes. Complexe industriel avec dalles, façades, vitrages, portes nervurées, équipements de toiture, clôture et entrée. Boîtiers des capteurs avec optique, bagues, vis, pare-soleil, câblage et socle. Drone avec coque arrondie, moteurs, hélices animées, patins et feux. Poste opérateur avec visage anatomique, casque, vêtements, clavier et éclairage local.

Le rendu EEVEE utilise 64 échantillons, AgX, profondeur de champ sur les gros plans et flou de mouvement. La direction visuelle reste une illustration 3D de présentation. Les volumes bleus sont des visualisations de champ optique.

## Implantation finale

Le complexe est délimité par une clôture rectangulaire. Trois caméras locales illustrent la triangulation. Vingt autres longent le périmètre et regardent vers l'extérieur. Treize capteurs avancés sont placés au-delà de la clôture pour illustrer l'alerte anticipée. Les 36 capteurs sont visibles dans le dernier cadre.

Le terrain, le drone, les observations et le point sur la carte utilisent les mêmes coordonnées et la même horloge. Les trois vignettes du PC montrent des rendus réels des caméras optiques, avec un repère de détection projeté. Les 192 images par caméra sont incorporées sous forme d'atlas pour rendre le fichier Blender autonome.

L'implantation reste fictive : les distances de portée et les performances du système ne sont pas mesurées par ce film.

## Reproduire le film sous Windows

Prérequis : Blender 5.2, Python avec Pillow, FFmpeg dans le PATH. Les commandes sont exécutées depuis la racine du projet.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b --python animation/v3/build_film.py -- --stills
python animation/v3/render_batch.py --feeds
python animation/v3/pack_camera_feeds.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b animation/v3/output/pavois_film_v3.blend --python animation/v3/install_camera_feeds.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b animation/v3/output/pavois_film_v3.blend --python animation/v3/verify_film.py
python animation/v3/render_batch.py
python animation/v3/encode_film.py
python animation/v3/make_storyboard.py
python animation/v3/verify_delivery.py
```

Le calcul est réparti entre trois processus pour les vues du moniteur et le film HD. Les PNG déjà calculés sont conservés lors d'une reprise. La signature de la scène empêche de mélanger des images HD de deux versions différentes. Après modification de la scène, archiver les dossiers `output/sensor_feeds` et `output/frames_hd` avant un nouveau rendu. Réinstaller les atlas sur une scène fraîchement reconstruite.

## Sources des éléments

Le paysage, le matériel et le décor sont construits par les scripts du projet. La tête et le cou du personnage sont extraits de la base MakeHuman, asset CC0 1.0 Universal : [base.obj](https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/3dobjs/base.obj), [licence des assets](https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md#c-the-license-for-the-bundled-assets). Copie du mesh et de la licence dans `assets/`, récupération le 14 septembre 2026. Aucun code applicatif MakeHuman n'est utilisé. Police Bahnschrift fournie par Windows.

Les matériaux des habillages utilisent un passage transparent pour les rayons d’ombre afin de ne pas assombrir le décor ([documentation Blender](https://docs.blender.org/manual/en/5.0/render/shader_nodes/input/light_path.html)).

## V3.1 — légendes complémentaires

`output/pavois_film_v3_legendes_1080p.mp4` ajoute sept explications courtes avec des fondus de quatre images. Le montage et la piste vidéo de fond sont conservés. Le fichier `output/pavois_film_v3_legendes.blend` contient les mêmes légendes incorporées dans le compositeur, en plus de toute la scène 3D ; les plaques PNG sont empaquetées. Les couleurs des plaques passent par AgX lors d'un nouveau rendu Blender.

Les textes, positions et timecodes sont dans `captions.json`. Pour les modifier, éditer ce fichier puis lancer `python animation/v3/make_captions.py`. Ce script compose les légendes sur les images HD déjà calculées. Pour actualiser le fichier Blender, lancer Blender avec le fichier V3 original et le script `animation/v3/install_captions.py`. La V3 initiale est conservée.
