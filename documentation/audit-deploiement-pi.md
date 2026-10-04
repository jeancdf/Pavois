# Audit du déploiement Raspberry Pi — 10 septembre 2026

## Mise à jour après connexion aux Pi

Jean est une Pi 5 Model B ; Tanel et Walid sont des Pi 4 Model B. Les trois
machines utilisent Debian 13 ARM64 et reconnaissent leur caméra CSI OV5647.
Le backend `csi:N`, absent lors de l'audit initial, a depuis été ajouté : capture
locale avec rpicam-vid et décodage FFmpeg, sans récupération réseau de vidéo.
Les scripts d'installation, le service systemd et le workflow GitHub Actions
sont également ajoutés. Voir [le guide actuel](../pavois++/DEPLOYMENT_PI.md).

Les constats ci-dessous décrivent l'état **avant ces ajouts**. Conformément à la
demande, les corrections générales de fallback/reconnexion et les intégrations
IMU, GPS depuis le frontend et fusion multi-Pi ne font pas partie de ce déploiement.

## Montage cible précisé après l'audit initial

La Pi possède sa propre caméra et une IMU. Elle ne doit pas récupérer de vidéos
sur le réseau. Le frontend est hébergé sur le VPS ; la position GPS doit être
modifiable depuis ce frontend. Pour l'instant, l'adresse du VPS reste renseignée
dans le fichier de configuration de la Pi (`output_host`, `output_port`).

**Verdict pour ce montage : des développements sont nécessaires.**

- La capture locale V4L2 existe, mais le modèle et le raccordement de la caméra
  restent à préciser pour valider sa compatibilité ; aucun backend libcamera/rpicam
  n'est présent dans le runtime C++.
- Aucune lecture d'IMU n'a été trouvée dans le runtime C++. L'orientation est
  calculée depuis la configuration au démarrage du worker, puis reste fixe.
  Il faut intégrer le capteur et associer l'orientation à chaque observation,
  avec la calibration entre axes du capteur et axes de la caméra.
- La configuration GPS du frontend Angular est actuellement codée en dur dans
  `frontend-angular/src/app/config/cameras.config.ts`. Aucun circuit de modification
  persistante depuis le frontend vers le runtime Pi n'a été trouvé dans les
  composants examinés. Il faut prévoir interface, API, stockage et application
  des valeurs au composant qui réalise la fusion.
- L'adresse VPS dans le fichier est déjà prise en charge : aucun écran de réglage
  ni canal de modification distant de cette adresse n'est nécessaire à ce stade.
- La fusion actuelle rassemble plusieurs caméras dans un même processus Pi.
  Avec une seule caméra active, le programme envoie des observations 2D `raw` ;
  le VPS les diffuse mais ne les triangule pas. Si le montage comprend plusieurs
  Pi avec chacune une caméra, il faudra centraliser la fusion sur le VPS ou un
  autre nœud, et transmettre des observations incluant identité unique, temps,
  position, orientation et intrinsics. Le paquet `raw` actuel ne contient pas
  toutes ces données. Une caméra seule avec IMU ne fournit pas les observations
  multiples requises par la triangulation actuelle.

Les constats FFmpeg ci-dessous concernent le mode réseau existant et ne sont
donc pas des prérequis pour ce montage à caméra locale. Les problèmes de remontée
des erreurs, de validation de configuration et de supervision restent pertinents.

## Conclusion initiale sur les modes présents dans le dépôt

Le programme C++ semble portable vers Linux ARM, mais son fonctionnement
sur la Pi n'est pas encore validé. Un essai supervisé avec des flux réseau ou des
webcams YUYV est envisageable sans changer les sources, après configuration et
compilation sur la cible. Le fonctionnement autonome nécessite les corrections
de gestion des pannes ci-dessous. Aucun déploiement ni changement du code applicatif
n'a été effectué pendant cet audit.

## Périmètre et preuves

Le composant Pi est `pavois++` : capture, détection, fusion, tracking et sortie UDP.
Les scripts de déploiement et le Compose actuels concernent le VPS et le frontend.
L'analyse porte sur les fichiers présents dans le workspace, qui contenait déjà
de nombreuses modifications Git.

- Compilation des 16 sources de la bibliothèque et des quatre exécutables avec
  GCC, C++17, optimisation O2 et pthread : réussite, sans diagnostic sur la
  compilation de la bibliothèque avec Wall/Wextra/Wpedantic.
- CMake est absent de cet environnement : compilation directe avec g++, pas de
  validation de la commande CMake/CTest elle-même.
- `pavois_selftest` : 154/154 contrôles réussis.
- `pavois_accuracy` : seuil de validation passé, score synthétique 93,4 %,
  scénario le plus faible 89 %, faux positifs sur scène vide 0 %.
- Exécutable réel avec replay de trois caméras, 90 images par caméra : sortie 0,
  36 lignes de pistes GPS émises, sans erreur stderr.
- Caméra locale inexistante : erreur journalisée mais sortie du programme **0**.
- Configuration inexistante, depuis un répertoire sans configuration de repli :
  tentative silencieuse sur `/dev/video0`, puis sortie **0** malgré l'échec.
- FFmpeg simulé en échec immédiat, cinq tentatives configurées : seulement deux
  processus lancés au total, puis arrêt du worker et sortie **0**.

Les exécutables et résultats sont dans `/tmp/pavois-pi-audit` sur la machine
d'audit Linux x86_64. Ces tests ne mesurent ni les performances ARM, ni les
caméras physiques, ni la réception UDP sur le VPS, ni l'affichage navigateur.
FFmpeg réel est également absent de cette machine. Le score synthétique n'est
pas une mesure de fiabilité de détection de drones sur le terrain.

## Corrections à prévoir

| Priorité | Constat et conséquence | Modification proposée |
| --- | --- | --- |
| Avant exploitation autonome | `src/runtime/camera_worker.cpp:93` et `:110` quittent le thread en cas d'échec ; `src/main.cpp:170` retourne toujours 0 après les jointures. Une Pi peut ne plus capturer tout en paraissant avoir terminé normalement ; un simple Restart=on-failure ne suffit pas. | Remonter l'état des workers, réessayer les erreurs récupérables, retourner un code non nul si le service devient inutilisable. Superviser également les pannes partielles. |
| Avant exploitation autonome | `src/v4l2_camera.cpp:257` considère le succès de popen comme une reconnexion réussie, sans vérifier une image. La deuxième lecture échouée arrête le worker. `fread` et `pclose` peuvent également attendre sans borne applicative. | Compter les tentatives jusqu'à réception d'une image valide ; ajouter délais de lecture, contrôle du processus FFmpeg et arrêt/récupération bornés. Tester flux absent, gelé, puis rétabli. |
| Avant exploitation autonome | Aucun service Pi ni installation automatique dédié dans le dépôt. | Ajouter installation du binaire et de sa configuration, service systemd, politique de redémarrage, droits caméra, journaux et arrêt propre des workers/FFmpeg. Employer un chemin absolu de configuration. |
| Avant exploitation autonome | `src/config/config_loader.cpp:148` accepte un fichier manquant ; les valeurs mal formées peuvent conserver les valeurs par défaut. `src/main.cpp:29` peut remplacer un chemin explicitement demandé par une autre configuration. | Refuser un fichier explicitement demandé mais absent ; valider dimensions, identifiants uniques, poses, GPS, ports et bornes des paramètres. Expliquer chaque erreur au démarrage. |
| Selon matériel | `src/v4l2_camera.cpp:129` exige une capture V4L2 YUYV avec streaming mmap. Aucun backend libcamera/rpicam n'est présent. | Pour une webcam, vérifier ses modes réels. Pour des modules CSI, ajouter une source libcamera/rpicam ou un pont de streaming compatible ; valider sur le modèle exact. |
| Selon matériel | `src/v4l2_camera.cpp:375` suppose des lignes contiguës de largeur × 2 octets, sans exploiter bytesperline ; les intrinsics restent calculés pour la résolution demandée si le périphérique en négocie une autre. | Utiliser le stride et contrôler la taille des buffers ; refuser une résolution différente ou recalculer correctement les intrinsics. |
| Fiabilité 3D | Les images sont horodatées après lecture/décodage (`src/v4l2_camera.cpp:298`, `:338`), pas à l'exposition. La purge FFmpeg attend une image complète dans le pipe, condition non garantie à 1280×720. La fenêtre de fusion de 90 ms ne garantit donc pas la simultanéité des prises de vue. | Mesurer le retard réel ; utiliser des timestamps de capture/PTS cohérents, une file bornée gardant la dernière image et une synchronisation adaptée aux caméras. |
| Fiabilité de transmission | `src/main.cpp:119` désactive définitivement l'UDP si son ouverture échoue ; les erreurs d'envoi enregistrées dans `udp_sender.cpp` ne sont pas remontées par les workers. | Journaliser/compter les pertes et prévoir la réouverture après indisponibilité initiale du réseau ou de la résolution de nom. |

## Configuration à adapter, même pour un essai

Le fichier livré contient trois URL HTTP privées, une destination VPS, des
positions GPS et des orientations précises. Il n'est réutilisable tel quel que
si ces valeurs correspondent effectivement à l'installation cible.

La 3D nécessite au moins deux caméras voyant la même cible avec une géométrie
exploitable. Les caméras 0 et 1 sont séparées d'environ un mètre d'après leur GPS ;
la caméra 2 regarde dans la direction opposée. Le recouvrement utile et la
parallaxe doivent être vérifiés sur place, pas déduits du seul nombre de caméras.
Avec une seule caméra activée, le runtime prévoit des observations 2D brutes.

Conserver une référence GPS correcte pour l'intégration actuelle : sans référence,
`src/runtime/camera_worker.cpp:79` émet des coordonnées locales sous le même préfixe
`obj`, alors que `vps/src/udp/udp.service.ts` interprète ces champs comme latitude et
longitude. Avec la référence fournie, les formats CSV et le port UDP 41234
concordent côté producteur et consommateur, par inspection du code.

## Validation sur la cible avant feu vert

1. Identifier le modèle de Pi, son OS/architecture et le type des caméras.
2. Installer un compilateur C++17, CMake >= 3.16 et FFmpeg pour les flux réseau ;
   compiler sur la Pi et exécuter les deux tests existants.
3. Fournir une configuration correspondant au réseau, aux caméras et à leur
   calibration ; vérifier que plusieurs caméras observent simultanément la cible.
4. Mesurer cadence, latence, CPU, mémoire et température avec les trois flux 720p.
5. Vérifier réception UDP sur le VPS et position affichée dans le navigateur.
6. Après corrections, tester débranchement/rebranchement, perte réseau, flux gelé,
   arrêt du service et redémarrage complet de la Pi.

La documentation officielle décrit la pile caméra Raspberry Pi basée sur
libcamera/rpicam :
[Camera software](https://www.raspberrypi.com/documentation/computers/camera_software.html).
Elle justifie la distinction entre webcam V4L2 compatible et module CSI ; la
compatibilité exacte dépend du matériel et de l'OS encore non renseignés.
