# Plan long terme — Détecter des drones lointains avec des caméras passives
### (version expliquée pour débutant)

## C'est quoi le projet, en une phrase
On veut repérer de **petits objets volants loin** (au-delà de ~300 m), dans le ciel, **uniquement avec des caméras** (pas de radar), et que ça tourne sur un **Raspberry Pi**.

## Le point de départ (à retenir)
Le code actuel est fait pour détecter de **gros mouvements proches**, et il **efface justement** les petites taches faibles d'un drone lointain (filtre « tout ce qui fait moins de 32 pixels = poubelle »). On ne repart pas de zéro : on le fait **évoluer brique par brique**.

## La règle du jeu
- Chaque phase est **testable toute seule** → tu vois des progrès concrets à chaque étape.
- On peut **s'arrêter ou ajuster** à tout moment.
- On garde la devise : le plus simple qui marche, on réutilise l'existant, pas de dépendance inutile.

---

## Phase 0 — L'œil du système : l'optique ✅ (déjà fait par toi)
**Ce que tu as fait :** changé la caméra pour passer de **170° à 90°** de champ de vision.

**Pourquoi c'est crucial :** plus le champ est étroit, plus chaque pixel « zoome » sur une petite portion de ciel, donc un drone lointain occupe **plus de pixels**. En fisheye 170°, un drone à 300 m fait une fraction de pixel = invisible. À 90°, il devient presque 2× plus gros à l'image. **Aucun logiciel ne peut voir un objet plus petit qu'un pixel** — donc c'est LA condition pour que tout le reste serve.

**Pour vérifier ta portée réelle** (refais le calcul avec ta vraie caméra) :
```
Portée_max (1 pixel) ≈ taille_du_drone × nombre_de_pixels_en_largeur ÷ angle_en_radians
Exemple : drone 0,3 m, capteur 1920 px, 90° (= 1,57 rad)
       → 0,3 × 1920 ÷ 1,57 ≈ 366 m pour 1 pixel
```
Pour le voir « confortablement » (2–3 px), divise par 2 ou 3. Si tu veux plus de portée plus tard : objectif encore plus serré (ex. 45°) ou capteur avec plus de pixels (4K). C'est un **curseur** que tu peux retourner.

**Compromis à garder en tête :** champ étroit = on voit loin **mais** une petite zone de ciel. On y revient en Phase 5.

---

## Phase 1 — VOIR la cible : nouvelle détection « petite-cible » (sur 1 seule caméra)
**Ce qu'on fait :** on remplace le cœur de détection actuel (`motion_mask_for_frame` dans `realtime_multi_voxel_preview.py`) par 3 briques :
1. **Modèle de fond lent** — le ciel change doucement : on garde une image « moyenne » du ciel et on regarde ce qui s'en détache.
2. **Filtre rehausseur de points (« top-hat »)** — au lieu d'effacer les petites taches, il les fait **ressortir**. (Comme un surligneur qui n'éclaire que les tout petits points qui tranchent sur le fond.)
3. **Centroïde sous-pixel** — une fois la tache trouvée, on calcule sa position précise « entre les pixels », pas juste la case entière.

**Pourquoi :** c'est l'**inverse exact** du code actuel. Aujourd'hui on jette les petites taches → on jette le drone. Là, on cherche **spécifiquement** le petit point faible, et on note sa position **très précisément** (la précision, c'est tout ce qui compte pour le lointain).

**Comment savoir que ça marche :** tu pointes la caméra vers le ciel avec un avion/drone lointain ; un marqueur doit **s'accrocher** au point et le suivre, même minuscule. **C'est la phase qui décide si le projet est viable** → à faire en premier, sur de vraies images.

**Outils :** OpenCV + numpy, **0 nouvelle dépendance** (le top-hat existe déjà dans OpenCV).

---

## Phase 2 — SUIVRE dans le temps : accumulation + pistes (« track-before-detect »)
**Ce qu'on fait :** on **additionne le signal faible sur plusieurs images** en suivant le déplacement supposé de l'objet, **avant** de décider « c'est une cible ». Puis on relie les détections image après image en **pistes** (trajectoires).

**Pourquoi :** un drone très lointain peut être **trop faible** sur une seule image. En cumulant sur plusieurs images — **comme une photo en pose longue qui révèle des étoiles invisibles à l'œil nu** — il finit par ressortir nettement. Et une « piste » (suite de positions) est bien plus fiable qu'une détection isolée.

**Comment savoir que ça marche :** une cible faible qui clignote au seuil devient une **piste continue et stable** ; un scintillement aléatoire (bruit) ne forme **pas** de piste.

**Bonus :** ça commence à filtrer les faux positifs — ce qui ne se déplace pas « comme un objet en mouvement » est ignoré.

---

## Phase 3 — Passer en 3D : 2e caméra + triangulation analytique (on supprime les voxels)
**Ce qu'on fait :** on ajoute une **2e caméra**. Chaque caméra fournit un **rayon** (une direction vers l'objet). On calcule le **point où les rayons se croisent le mieux**, et on mesure l'**écart résiduel** comme contrôle de qualité. On supprime la grille de voxels.

**Pourquoi :**
- La grille de voxels ne peut **pas** couvrir des centaines de mètres (trop de mémoire) et est **imprécise** (cases de 0,35 m). Le croisement de rayons est **léger, précis, et marche à n'importe quelle distance**.
- L'écart entre rayons est un **détecteur de mensonge gratuit** : vrai objet → rayons qui se croisent bien ; parasite (le fameux moustique) → rayons qui ne se rejoignent pas → **rejeté**.

**Comment savoir que ça marche :** tu obtiens une **position/direction 3D** de l'objet ; un moustique devant une seule caméra ne produit **aucune** cible 3D.

**Note honnête :** pour une vraie **distance** (et pas juste une direction), il faut **écarter les caméras** (plusieurs mètres, idéalement des dizaines). Sinon tu as surtout une **direction** très précise.

**Outils :** un petit calcul d'algèbre (moindres carrés) en numpy — quelques lignes, pas besoin de PyTorch.

---

## Phase 4 — Faire tourner VITE sur le Raspberry Pi
**Ce qu'on fait :**
- On **retire PyTorch** du temps réel (inutile une fois les voxels supprimés).
- On passe la capture caméra par **libcamera / picamera2** (la voie native et efficace du Pi).
- On ne traite que des **petites zones d'intérêt (ROI)** autour des pistes, au lieu de toute l'image.

**Pourquoi :** PyTorch est **lourd et lent** sur Pi (CPU seulement). Le nouveau pipeline (filtre top-hat + quelques rayons) est **assez léger** pour viser un bon FPS, surtout avec OpenCV déjà optimisé pour les puces ARM (instructions NEON).

**Comment savoir que ça marche :** tu atteins le **FPS visé** sur le Pi avec 1 puis 2 caméras, sans saccades.

---

## Phase 5 — Aller plus loin (optionnel, plus tard)
- **Grande base entre caméras** : pour mesurer la vraie **distance**, pas juste la direction.
- **Couvrir plus de ciel** : un champ étroit voit peu → soit plusieurs caméras qui **pavent** le ciel, soit une caméra « grand-angle de repérage » + une caméra « téléobjectif de suivi ».
- **Rejet des faux positifs difficiles** (oiseaux, nuages, reflets du soleil) : on peut ajouter une **petite IA**, et là un **accélérateur** (Raspberry Pi AI Kit / Hailo, ou Coral USB) devient utile. À ne faire **que si nécessaire** (ça ajoute du matériel et des dépendances).

---

## Pourquoi cet ordre
1. **VOIR** (Phase 1) d'abord, car sans ça rien d'autre ne sert.
2. **SUIVRE dans le temps** (Phase 2) pour fiabiliser et capter le très faible.
3. **3D** (Phase 3) une fois qu'une caméra marche bien.
4. **Pi** (Phase 4) pour la cible matérielle finale.
5. **Le reste** (Phase 5) seulement si le besoin se confirme.

Chaque phase est une victoire visible. On peut tester, montrer, et décider d'avancer ou d'ajuster à chaque palier.

## Les vrais points durs (pour ne pas avoir de surprise)
- **L'optique** (en grande partie réglée par toi en Phase 0).
- **Le tri des faux positifs** (oiseaux/nuages) — c'est ça qui demandera le plus de soin, pas la vitesse.
- La **distance 3D précise** dépend surtout de l'**écartement des caméras**, pas du logiciel.
