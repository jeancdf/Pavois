[← État et limites](13-etat-et-limites.md) · [🏠 Accueil](README.md)

# 📖 Glossaire

> Les mots du projet, dans l'ordre alphabétique. Entre parenthèses, le nom
> utilisé dans le code quand il diffère.

---

**Alerte évolutive** — Alerte de piste qui peut monter de niveau
(`OBJECT_DETECTED` → `TO_VERIFY` → `DRONE_CONFIRMED`) mais jamais redescendre.
→ [Le serveur VPS](05-serveur-vps.md#-les-alertes)

**Anti-rejeu** — Refus d'un paquet UDP dont l'horodatage a plus de 2 s de retard
ou 1 s d'avance : un paquet capturé ne peut pas être renvoyé plus tard.
→ [Protocoles](07-protocoles.md#-lenveloppe-signée)

**`att`** — Ligne UDP qui porte l'orientation de la caméra (cap, élévation,
roulis), sa calibration et sa validité.

**Banc de rejeu** — Script qui rejoue une session enregistrée dans toute la
chaîne (trois détecteurs, VPS, interface) sur un seul poste.
→ [Tests et outils](12-tests-et-outils.md#-banc-de-rejeu)

**Banc rail (V5)** — Rail imprimé en 3D d'1 m portant les trois caméras
(`tanel`, `jean`, `walid`), pour les essais à 2–3 m.

**BNO08x / BNO055** — Centrales inertielles (IMU) en I2C. Les Pi actuelles ont un
BNO08x (`0x4a`) lu par un service Python ; le détecteur sait aussi lire un BNO055
directement.

**Cap** (*heading*) — Direction visée, en degrés depuis le Nord, dans le sens
des aiguilles d'une montre.

**`cfg`** — Ligne UDP par laquelle un détecteur annonce les réglages qu'il
applique vraiment, avec leur version.

**Centroïde** — Centre de gravité d'une tache, en pixels. C'est lui qui devient
un rayon.

**ChArUco** — Mire de calibration qui combine un damier et des marqueurs ArUco :
détectable même partiellement visible.

**Confirmation M sur N** — Une tache n'est retenue que si elle a été vue dans M
des N dernières images (2 sur 3 par défaut).

**Covariance** — Matrice qui décrit l'incertitude d'un point 3D (un ellipsoïde).
Calculée par la triangulation, utilisée par le Kalman.

**CSI** — Connecteur caméra des Raspberry Pi. `camera.0.device=csi:0`.

**Croisement brut** (*raw intersection*) — Point le plus proche entre deux rayons,
calculé **avant** tout contrôle. Sert à juger la géométrie, jamais une cible.

**Distorsion** — Déformation de l'image par l'objectif (radiale `k1`, `k2`,
`k3`, tangentielle `p1`, `p2`), corrigée avant de faire le rayon.

**Élévation** — Angle de visée au-dessus de l'horizon, positif vers le haut.

**ENU** — Repère local *East-North-Up* : x vers l'Est, y vers le Nord, z vers le
haut, en mètres.

**Épisode** (de classification) — Un passage de cible près du banc : une seule
série de photos est demandée par épisode.

**Fantôme** — Faux point 3D né du croisement de rayons qui ne visent pas le même
objet. Rejeté si une autre caméra qui devrait le voir ne le voit pas.

**Fiabilité globale** — Résumé de la santé des caméras : 🟢 3 valides, 🟠 2,
🔴 0 ou 1 (« système aveugle »).

**`FrameWallClock`** — Heure de capture d'une image fournie par libcamera. Les
Pi datent leurs détections avec elle.

**`fuse_update`** — Événement WebSocket qui porte l'état de la fusion en repère
local : dernière fusion, croisements bruts, pistes.

**HMAC** — Signature d'un message par une clé partagée (`UDP_HMAC_SECRET`).
Prouve que le paquet vient d'un détenteur de la clé et n'a pas été modifié.

**IMU** — Centrale inertielle : accéléromètre, gyroscope et magnétomètre. Donne
l'orientation de la caméra.

**Intrinsèques** — Paramètres optiques d'une caméra : focales `fx`, `fy`, centre
`cx`, `cy`, distorsion.

**Jeton opérateur** — Secret (`WS_AUTH_TOKEN`) qui ouvre l'interface et l'API.
Forme `op:<nom>:<secret>` pour signer ses acquittements.

**JSONL** — Fichier texte avec un objet JSON par ligne. Le stockage des alertes,
pistes et états de caméra.

**Kalman (à vitesse constante)** — Filtre qui estime position et vitesse d'une
cible en combinant une prédiction (mouvement uniforme) et les mesures, chacune
pondérée par son incertitude.

**Mahalanobis (distance de)** — Distance entre une mesure et une prédiction,
exprimée en « nombre d'écarts-types ». Sert de porte d'association (≤ 11,34 au
carré).

**Origine** — Point GPS qui sert de zéro au repère ENU : la première observation
géolocalisée reçue.

**Parallaxe** — Angle entre deux rayons qui visent la même cible. Trop faible
(< 2°), le croisement est imprécis.

**Piste** (*track*) — Une cible suivie dans le temps, avec un identifiant `obj<n>`.
Provisoire, puis confirmée après 3 mesures, en roue libre sans mesure, oubliée
après 1,2 s.

**Pose** — Position et orientation d'une caméra. « Pose rail » : celle mesurée
sur le banc avec la mire.

**Préréglage** (*preset*) — Jeu de réglages à chaud enregistré : *Défaut*,
*Sensible*, *Strict*, *Multi-cibles*, ou personnalisé.

**RANSAC (simplifié)** — Avec 3 caméras ou plus, la triangulation essaie aussi
chaque groupe privé d'une caméra pour écarter une tache fausse.

**`raw`** — Ligne UDP qui porte une tache détectée, avec la pose et l'optique de
la caméra.

**Rayon** — Demi-droite qui part d'une caméra et passe par un pixel : l'objet est
quelque part dessus.

**Réglages à chaud** (*live tuning*) — Seuils du détecteur et paramètres de la
fusion modifiables depuis l'interface, sans redémarrer.

**Reprojection (erreur de)** — Distance en pixels entre la tache observée et
l'endroit où le point 3D calculé apparaîtrait dans l'image.

**Roue libre** (*coast*) — Une piste confirmée qui n'a pas reçu de mesure : le
Kalman continue de la prédire, jusqu'à 1,2 s.

**Roulis** (*roll*) — Rotation de la caméra autour de son axe de visée.

**`rpicam-vid`** — Outil Raspberry Pi qui pilote la caméra CSI. Le détecteur le
lance comme processus séparé.

**SGAM** — Les 4 caractères du niveau de calibration de l'IMU : système, gyro,
accéléro, magnéto, de `0` à `3` ou `-`.

**Staging** — La pile Docker déployée automatiquement sur le VPS (interface sur
le port 8081). C'est celle que visent les Pi.

**`stats`** — Ligne UDP envoyée chaque seconde : i/s, luminance, netteté,
exposition, gain. Nourrit la santé des caméras.

**Tache** (*blob*) — Groupe de pixels voisins qui ont changé par rapport au fond.

**Tick** — Un instant de la grille de temps de la fusion, toutes les 33 ms.

**`track_update`** — Événement WebSocket qui porte une piste en coordonnées GPS.

**Triangulation** — Calcul du point 3D le plus proche de plusieurs rayons.

**Watermark** — Dans la fusion, l'heure de la donnée la plus récente reçue toutes
caméras confondues. Un tick est traité de force quand elle le dépasse de 80 ms.

---

[← État et limites](13-etat-et-limites.md) · [🏠 Accueil](README.md)
