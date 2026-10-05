# PAVOIS — Du mouvement à la position

> Version V1 conservée comme référence de la première animatique. Le scénario courant est désormais [PAVOIS — Changer d’échelle (V2)](scenario-v2.md), avec vol du drone, champs de vision, opérateur et révélation d’un réseau étendu, sans voix off.

Scénario d’introduction 3D, version de travail du 13 septembre 2026.

Base : code actuel du dépôt. Référence fournie : [PAVOIS — Post-mortem (soutenance)](https://www.figma.com/slides/ZbbpzIb5ngK733IespCH5b/PAVOIS?node-id=25-2). Lecture Figma bloquée par le quota MCP du forfait Starter ; le navigateur disponible demande une connexion. Le contenu des diapositives n’a donc pas été consulté. Les choix graphiques ci-dessous viennent de l’interface Angular et restent à rapprocher de la présentation à partir d’un export ou d’un accès rétabli. Ce document prépare le script de création des objets et l’esquisse animée Blender ; il ne constitue pas un fichier Blender exécuté ou un rendu validé.

## Intention

En 40 secondes, faire comprendre une idée : une caméra repère un mouvement, plusieurs points de vue permettent d’en estimer la position 3D, les observations successives construisent une piste exploitable par l’opérateur.

Le spectateur suit le même objet du début à la fin. Une scène unique, sobre, se transforme progressivement en explication géométrique puis en carte. Le moment fort est la révélation de la profondeur grâce au deuxième point de vue.

Format proposé : 16:9, 1920 × 1080, 25 images/seconde, 1 000 images. Introduction de présentation, compréhensible sans voix off. Durées et focales sont des intentions à vérifier dans l’animatique.

## Découpage

| Temps | Image et action | Mouvement de caméra de réalisation | Texte à l’écran |
|---|---|---|---|
| 0–5 s | Une petite silhouette de quadricoptère traverse un ciel calme au-dessus d’un terrain abstrait. Aucun marquage au début. Un module optique se découvre au premier plan. | Travelling latéral lent, focale 50 mm. Le capteur au premier plan crée une parallaxe et donne une échelle. | « Un mouvement dans le ciel. » |
| 5–11 s | Raccord vers l’image du capteur A. Deux instants se superposent brièvement, le changement apparaît comme quelques pixels clairs. On conserve un centre de détection. | Cadrage fixe de l’image, puis recul et rotation d’environ 25° : l’image devient un petit plan flottant devant l’objectif. | « Une image donne une direction. » |
| 11–17 s | Une ligne géométrique traverse le centre optique et le pixel détecté, puis se prolonge. Trois petites silhouettes fantômes apparaissent à différentes profondeurs sur cette même ligne. | Déplacement en arc, focale 40 mm, pour voir la longueur de la ligne. Pause finale permettant de lire les trois positions possibles. | « Mais pas encore la distance. » |
| 17–25 s | Le capteur B entre dans le cadre. Son observation du même instant apporte une seconde ligne. Les deux lignes convergent dans une petite région lumineuse ; les positions fantômes disparaissent. Une troisième observation peut compléter la lecture en fin de plan. | Recul en diagonale et légère montée pour cadrer A, B et la cible. Fin de mouvement presque immobile pendant la convergence. | « Croiser les points de vue. » puis « Estimer une position 3D. » |
| 25–32 s | Le mouvement de la cible reprend. Des points de mesure apparaissent successivement, puis une courbe plus régulière les relie. Un repère « Piste 01 » accompagne l’objet. | Suivi latéral doux, focale 50 mm. Garder une partie des capteurs dans le cadre pour conserver le lien causal. | « Suivre le mouvement dans le temps. » |
| 32–37 s | La caméra monte. Le terrain devient une carte plane, la courbe devient une trace cartographique et le repère un marqueur. Une vue simplifiée de l’interface apparaît. | Montée vers une vue verticale, puis raccord sur la carte avec le marqueur au même emplacement à l’écran. | « Une piste sur la carte. » |
| 37–40 s | La carte s’atténue. Le point de la piste devient le point central du symbole hexagonal PAVOIS. Le nom apparaît, puis reste fixe. | Caméra fixe ; animation graphique en compositing. | « PAVOIS » — « Détecter. Localiser. Suivre. » |

### Réalisation en cours — scène silencieuse

À la demande de l’utilisateur, la première réalisation se concentre sur la scène 3D Blender, sans voix off. L’animatique de 32 secondes comporte quatre plans : observation, direction et profondeur ambiguë, convergence, suivi. Les raccords vers une interface cartographique et le logo final du scénario de 40 secondes restent hors de cette première scène. Voir `animation/README.md` et `animation/output/pavois_intro.blend`.

## Objets à préparer pour Blender

| Objet / groupe | Construction prévue | Animation |
|---|---|---|
| `ENV_Ground` | Plan mat, relief léger et quelques volumes bas ; horizon dégagé. | Fixe, puis transition vers la carte. |
| `TARGET_Drone` | Corps simple, quatre bras, quatre moteurs, hélices stylisées ; silhouette identifiable en plan rapproché. | Trajectoire unique et douce. Inclinaison légère dans le sens du déplacement. |
| `SENSOR_A`, `SENSOR_B`, `SENSOR_C` | Support existant du dépôt, avec caméra, Pi et IMU simplifiées. Réutiliser le STL du support V2 après vérification d’échelle. | Fixes pendant la démonstration. L’apparition des lignes est un habillage explicatif. |
| `IMAGE_A`, `IMAGE_B` | Plans 16:9 portant des images rendues depuis les capteurs virtuels. | Apparition, comparaison temporelle, accent sur les pixels détectés. |
| `RAY_A`, `RAY_B`, `RAY_C` | Courbes fines passant par les centres optiques et les observations correspondantes. | Révélation progressive ; intensité modérée. |
| `DEPTH_Ghosts` | Trois copies transparentes placées sur le rayon A. | Apparition pendant l’ambiguïté, extinction à la convergence. |
| `POSITION_Estimate` | Petit point et halo diffus, plutôt qu’un verrouillage parfaitement exact. | Apparition à la convergence, puis déplacement avec les estimations. |
| `TRACK_Samples`, `TRACK_Curve` | Points successifs et courbe de suivi. | Révélation dans l’ordre temporel. |
| `UI_Map`, `UI_Label`, `BRAND_End` | Éléments graphiques en compositing pour conserver une typographie nette. | Raccord carte, apparition du nom et du symbole. |

Le support réutilisable est `mounts/camera_mount_v2_pi25.stl`. Le banc réel à trois caméras est documenté dans `mounts/README_MODULAR_RIG_V05.md`. Le déploiement espacé de cette scène est un schéma pédagogique, distinct du banc de calibration réel.

## Esquisse spatiale et mouvements

Repère de scène proposé : X horizontal, Y profondeur, Z hauteur. Unité : mètre. Exemple de composition, sans revendication de portée ni de précision :

- Capteur A : (−8, 0, 1,5).
- Capteur B : (+8, 0, 1,5).
- Capteur C facultatif : (0, −6, 1,5).
- Cible : parcours de (−4, 16, 7) à (+4, 19, 8).
- Point de convergence pédagogique : environ (0, 18, 7,5).

Orienter les capteurs vers le milieu du parcours et vérifier que la cible reste dans leurs images. Pour la séquence de profondeur, figer le temps de la scène : les images A et B doivent correspondre au même instant. Reprendre le temps au début du suivi. Les silhouettes fantômes sont des hypothèses explicatives, pas plusieurs détections réelles.

La caméra qui filme le film est indépendante des caméras de détection. Prévoir des rigs de réalisation séparés pour les plans, avec une cible de visée par plan, afin d’éviter les rotations parasites. Conserver le sens gauche → droite du drone lors des raccords. Utiliser des départs et arrêts progressifs ; ne pas faire une orbite complète autour du système.

Premier blocage de caméra à essayer :

- Ouverture : travelling de (−12, −8, 5) à (−9, −8, 5), regard vers le drone, module A en amorce.
- Profondeur : partir près de A puis gagner une vue de côté où la ligne et les trois hypothèses se séparent nettement à l’écran.
- Convergence : cadrage depuis (20, −24, 18), regard vers (0, 9, 4). Ajuster pour que les deux lignes forment un angle lisible et que les modules ne se masquent pas.
- Suivi : translation latérale accompagnant la cible, sans brusque changement de focale.
- Carte : montée vers une vue verticale centrée sur le parcours ; finir avec une orientation stable pour le raccord graphique.

Ces poses sont des points de départ de mise en scène, à corriger après prévisualisation ; elles n’ont pas encore été testées dans Blender.

## Direction artistique et son

Base issue de l’Angular : bleu nuit `#0B1220`, bleu `#3B82F6`, blanc `#F1F5F9`, typographie IBM Plex Sans. Ajouter un cyan pour différencier le deuxième point de vue. Matériaux mats, arêtes doucement éclairées, ombres propres. Donner priorité à la silhouette et à la lecture des lignes ; limiter la profondeur de champ pendant l’explication.

Les lignes représentent des directions calculées : éviter les effets de tirs laser, de balayage radar ou d’ondes émises par les capteurs. L’observation est optique passive. Un discret souffle ouvre le film, de petits sons accompagnent les observations, une note tenue souligne la convergence. Fin calme, sans sirène.

Le symbole final reprend le motif de l’interface : deux hexagones et un point central. Son adaptation doit être comparée au Figma avant finalisation.

## Fidélité au projet

Le code actuel suit le chemin : détection de mouvement embarquée → observations et pose caméra → alignement temporel et triangulation sur le VPS → suivi Kalman → pistes transmises à l’interface Angular. Les anciens documents décrivant un frontend React simulé ne doivent pas servir de référence au film.

La classification actuelle est une heuristique cinématique. L’intro emploie donc « piste » et « position estimée », sans promettre une identification certaine, une précision métrique ou une portée démontrée. Le halo de position est une convention graphique, pas une covariance calculée. Toute donnée chiffrée ajoutée à l’interface de démonstration devra être signalée comme simulée.

Les voxels peuvent apparaître dans une variante consacrée à l’origine du projet : au plan de convergence, remplacer brièvement le halo par quelques cellules translucides. Cette variante doit porter la mention « principe du prototype voxel » ; elle ne décrit pas le calcul du pipeline actuel. La version principale conserve les rayons et la triangulation.

## Préparation de l’animatique

1. Créer les volumes gris, le drone, les capteurs et les rigs de réalisation.
2. Bloquer les sept plans aux durées ci-dessus, sans matériaux coûteux.
3. Produire les images A/B depuis une seule scène et un même instant ; vérifier la cohérence pixel → rayon → cible.
4. Ajouter lignes, hypothèses de profondeur et piste ; vérifier la compréhension sans voix off.
5. Prévisualiser les 40 secondes en basse définition ; corriger cadrages et pauses avant les rendus finaux.
6. Comparer palette, logo, vocabulaire et dernier écran à la présentation Figma dès que son contenu est accessible. Pour la soutenance, enchaîner après le logo par : « Voici le principe que nous avons voulu mettre à l’épreuve. » Cette transition proposée ouvre sur les résultats et les limites du prototype.

Le script Blender existant `pixeltovoxelprojector/blenderrenderscript.py` génère des vues pour des expériences multi-caméras ; il ne constitue pas l’introduction. Prévoir un script de scène dédié, déterministe, créant ses propres objets, avec les temps et poses regroupés en paramètres.

## Sources locales consultées

- `README.md` : composants actuels.
- `pavois++/src/detection/motion_detector.cpp` : détection par changement d’image.
- `vps/src/fusion/fusion.service.ts` : alignement, triangulation et émission des pistes.
- `vps/src/fusion/triangulation/fusion-triangulate.ts` : intersection approchée et contrôles géométriques.
- `vps/src/fusion/tracking/fusion-tracker.ts` : suivi Kalman et confirmation temporelle.
- `documentation/technical-file/limitations-roadmap.md` : distinction pipeline actuel/prototype voxel et limites de validation.
- `frontend-angular/src/styles.css` et `frontend-angular/src/app/components/top-bar/top-bar.html` : palette, typographie et symbole.
- `mounts/README.md`, `mounts/README_MODULAR_RIG_V05.md` : géométrie matérielle réutilisable.
- `documentation/docs/businness-summary.md` : intention et positionnement du projet, à distinguer des capacités validées.
