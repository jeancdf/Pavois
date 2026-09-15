# Déploiement sur les Raspberry Pi

Le programme capture la caméra CSI **locale**, détecte les mouvements et envoie
les observations au VPS en UDP. Le frontend reste sur le VPS. Une Pi avec une
caméra émet des détections 2D `raw` et, si un BNO055 est présent, l'orientation
live (`att`) pour les cônes de la carte. Les positions GPS réglées depuis le
frontend sont stockées sur le VPS ; elles ne sont pas encore recopiées dans la
configuration des Pi.

## Machines inspectées

| Compte | Adresse au 10 septembre 2026 | Matériel | Label GitHub unique |
| --- | --- | --- | --- |
| jean | 192.168.1.94 (Wi-Fi Freebox) | Pi 5 Model B, OV5647, Debian 13 ARM64 | pi-jean |
| tanel | 192.168.1.83 (Wi-Fi Freebox) | Pi 4 Model B, OV5647, Debian 13 ARM64 | pi-tanel |
| walid | 192.168.1.13 (Wi-Fi Freebox) | Pi 4 Model B, OV5647, Debian 13 ARM64 | pi-walid |

Les adresses DHCP peuvent changer. Les jobs GitHub ne dépendent pas de ces
adresses : un runner installé sur chaque Pi reçoit les jobs via sa connexion
sortante à GitHub. Aucun mot de passe SSH n'est enregistré dans le dépôt.

Jean a également été accessible sur Ethernet à `192.168.1.60` pendant la
configuration. Tanel a été configuré via Ethernet à `192.168.1.43`.
Le profil NetworkManager `pavois-Freebox-894D94` reconnecte Jean et Tanel au Wi-Fi
automatiquement ; Walid disposait déjà de son profil Freebox avec reconnexion
automatique. Aucun mot de passe Wi-Fi n'est enregistré dans ce dépôt.

## Première installation sur chaque Pi

Depuis une copie de ce dépôt contenant ces scripts, sous le compte de la Pi :

```bash
sudo bash scripts/setup_pi.sh "$(id -un)"
sudo nano /etc/pavois/pavois.conf
```

Renseigner `output_host` avec l'adresse réelle du VPS et `output_port=41234`
(staging OVH écoute 41234 et 41235).
Le script attribue le nom de la Pi à `camera.0.id` : garder des identifiants
différents sur chaque Pi. La caméra est sélectionnée par `camera.0.device=csi:0`,
à comparer avec `rpicam-hello --list-cameras`. Le modèle de configuration propose
1280x720 avec `camera.0.limit_fps=false` (valeur par defaut) : demande de
cadence maximale au capteur sur Pi 4 comme Pi 5. Le programme demande 1000
images/s au pilote, qui ramene cette demande au maximum materiel disponible.
Ce n'est pas une promesse de 1000 FPS. Les anciennes valeurs `camera.0.fps`
(10, 20, 30...) sont ignorees tant que `camera.0.limit_fps` n'est pas active.
Le deploiement du binaire suffit : aucune modification privilegiee des
fichiers `/etc/pavois/pavois.conf` n'est necessaire pour retirer les limites.
Pour limiter volontairement, utiliser `camera.0.limit_fps=true` et un
`camera.0.fps` positif. Le flux MJPEG est décodé puis traité dans l'ordre,
comme avant les optimisations du 15 septembre au matin.

Le pilote peut choisir un autre mode capteur a cadence maximale (recadrage ou
resolution native). Verifier les intrinseques du rail avant de reutiliser une
calibration. L'outil terrain utilise son mode fixe 1920x1080 ; ne pas reutiliser
cette calibration pour un autre mode de capture.

Au démarrage, la Pi laisse l'exposition et la balance des blancs automatiques
se stabiliser pendant `camera.0.startup_calibration_ms=1500`, puis le détecteur
apprend son fond. `camera.0.manual_exposure=false` ignore aussi les anciens
réglages 750 us / gain 4. Pour les réactiver volontairement, passer cette option
à `true` et fournir le shutter, le gain et les deux gains AWB.

Le script installe les dépendances, le compte de service `pavois` et le service
systemd. Il autorise le compte de déploiement à remplacer le binaire et à
redémarrer uniquement ce service via sudo. L'orientation vient de l'IMU
(BNO055 en I2C) lorsqu'elle est détectée ; sinon `heading_deg` du fichier
reste la valeur de repli. Pour caler le cap, **ne pas éditer
`imu.heading_offset_deg` à la main** — utiliser `pavois_imu_calib` (voir
section « Calibration terrain » plus bas), qui guide la manœuvre, calibre la
puce et écrit l'offset lui-même.
`imu.i2c_address=0` sonde automatiquement 0x28 puis 0x29 ; une valeur >0
sonde uniquement cette adresse. `imu.elevation_sign` vaut 1 par defaut ;
mettre `-1` pour inverser le pitch.

Après une mise à jour qui ajoute l'IMU, relancer une fois
`sudo bash scripts/setup_pi.sh "$(id -un)"` pour installer la règle udev I2C
et activer le bus.

L'ancien `pavois-camstream.service`, s'il existe, est désactivé au démarrage et
sera arrêté lorsque le détecteur démarre : les deux utilisent la même caméra.
Le script de streaming d'origine est conservé.

Premier déploiement :

```bash
bash scripts/deploy_pi.sh
sudo journalctl -u pavois.service -n 50 --no-pager
```

Le binaire est compilé sur la Pi, installé dans `/opt/pavois/bin/pavois_detect`,
puis le service est redémarré. `/etc/pavois/pavois.conf` est conservé lors de chaque
déploiement et lors d'une nouvelle exécution du script d'installation. Les
processus rpicam-vid et FFmpeg sont locaux ; aucune vidéo n'est récupérée par HTTP
ou RTSP. FFmpeg décode le MJPEG en niveaux de gris sans dépendre du stride des
buffers bruts libcamera.

## GitHub Actions

Sur le dépôt GitHub, ouvrir **Settings → Actions → Runners → New self-hosted
runner**, choisir Linux ARM64 et récupérer le jeton temporaire affiché après
`--token`. Sur chaque Pi, lancer sous son compte utilisateur :

```bash
# Adapter le label : pi-jean / pi-tanel / pi-walid
bash scripts/register_pi_runner.sh pi-jean
```

Le script télécharge et vérifie le runner ARM64, demande le jeton sans l'afficher,
enregistre la Pi et installe le runner comme service. Utiliser les runners pour
les déploiements de ce dépôt de confiance ; ne pas y exécuter de code de PR externe.

Le workflow `.github/workflows/deploy-pi.yml` :

1. Se déclenche à chaque **push sur `main`**, y compris ceux créés par un merge,
   et peut être lancé manuellement sur `main`.
2. Compile et exécute les tests sur un runner GitHub Linux.
3. Lance un job distinct sur chaque Pi avec son **label unique**, récupère le
   commit de l'événement, compile le détecteur puis redémarre le service.

Les déploiements sont sérialisés **par Pi**, sans interrompre celui en cours.
Une Pi hors ligne ne bloque donc pas les mises à jour des autres. GitHub peut
remplacer une exécution en attente par une plus récente si les pushes s'enchaînent.
Une Pi hors ligne ne reçoit pas son job tant que son runner n'est pas reconnecté.
Pour limiter les cibles, définir la variable de dépôt `PI_RUNNERS`, par exemple :

```json
["pi-tanel", "pi-walid"]
```

Sans cette variable, les trois labels du tableau sont ciblés. Aucun secret SSH
ni ouverture de port entrant n'est nécessaire pour ce workflow. Le fichier doit
être poussé sur `main` et les runners enregistrés pour activer l'automatisation.

## Vérifications

Validation effectuée le 10 septembre 2026 : compilation native ARM réussie,
154 contrôles du selftest et seuil de précision synthétique réussis, test CSI
(découpage des images, pixels, fin de flux) réussi. Les trois services ont été
installés, activés au démarrage et observés en capture continue sans redémarrage
automatique pendant la vérification. Les alias SSH locaux ont été testés avec
`BatchMode=yes`, donc sans recours au mot de passe.

Les trois runners `pi-jean`, `pi-tanel` et `pi-walid` ont été enregistrés dans
GitHub et leurs services sont activés au démarrage. Les trois configurations
Wi-Fi Freebox sont persistantes et les connexions SSH par clé ont été vérifiées.
La publication du workflow sur `main` et sa première exécution restent
nécessaires pour valider le circuit de déploiement automatique complet.

```bash
ssh pavois-jean  # alias local créé pendant l'installation à distance
systemctl is-active pavois.service
sudo journalctl -u pavois.service -f
```

Une ligne `camera <id> f=120` confirme que le détecteur a traité 120 images.
L'état systemd `active` seul ne prouve pas que la caméra capture ni que le VPS
reçoit les paquets. Un test temporaire avec `--debug-dir` permet aussi d'inspecter
les images ; arrêter le service avant tout second programme utilisant la caméra.

Références : [rpicam-apps](https://www.raspberrypi.com/documentation/computers/camera_software.html),
[runners avec labels](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/use-in-a-workflow).


## Correctif t�l�m�trie et BNO08x � 11 septembre 2026

Les trois Pi ont un capteur compatible BNO08x � `0x4a` sur `/dev/i2c-1`,
confirm� par des lectures de quaternions avec le pilote Adafruit. Le pilote BNO055
� `0x28/0x29` ne convient pas. `sudo bash scripts/setup_bno08x.sh` installe le
lecteur d�di� `pavois-imu.service`; le C++ lit ses angles depuis un fichier atomique
et rejette un fichier vieux de plus de deux secondes. Le service Python red�marre
apr�s une erreur du capteur. Le cap d�pend du montage : r�gler les offsets IMU
pour aligner les axes de la cam�ra apr�s installation.

Sur chaque Pi, `output_host=51.91.98.159` et `output_port=41234` ciblent le VPS
Pavois. La preview utilise ce m�me h�te, port 8081 et chemin `/api/preview`.
L'ancienne adresse `51.15.213.226` ne doit plus �tre utilis�e pour ce VPS.

Le backend exige HMAC-SHA256. Fournir sa m�me cl� dans
`/etc/pavois/telemetry.env` sous `UDP_HMAC_SECRET=...`, propri�taire root, mode 0600.
Ne jamais committer ce fichier. Le C++ signe le timestamp Unix en millisecondes
(big endian, 8 octets) suivi du CSV, puis �met timestamp + HMAC (32 octets) + CSV.
Installer `libssl-dev` avant compilation. Le service attend la synchronisation
NTP pour respecter la fen�tre anti-rejeu du backend.

Validation en production : les �v�nements WebSocket `imu_update` et
`camera_preview` sont re�us pour jean, tanel et walid; les JPEG sont accept�s en
HTTP 201 et les paquets UDP en HMAC OK. Les trois tests C++ passent sur ARM64.


## Calibration terrain (pavois_imu_calib)

Remplace l'ancienne procédure manuelle (éditer `imu.heading_offset_deg` à la
main, redémarrer, regarder la carte, recommencer) par un outil guidé. Rend la
calibration reproductible d'une Pi à l'autre : trois personnes qui calibrent
trois Pi avec cet outil, en visant le même type de repère, doivent obtenir
des caps comparables.

Prérequis :
- Le service `pavois-imu.service` déjà installé (`setup_bno08x.sh`).
- Un repère visuel dont le relèvement (cap réel, 0-360°, mesuré depuis la
  position de la caméra) est connu — carte, boussole, ou calcul GPS vers un
  point de repère fixe.
- Accès `sudo` sur la Pi.

Lancement :

```bash
sudo /opt/pavois/imu-venv/bin/python /opt/pavois/pavois_imu_calib.py
```

Déroulé :
1. L'outil arrête `pavois-imu.service` (il utilise le même bus I2C) et se
   connecte directement au capteur.
2. **CALIB_STAT en direct** : affiche le cap courant et le statut de
   calibration du capteur (0 à 3) en continu. Effectuer une manœuvre en huit
   avec la caméra (mouvement large sur les trois axes) jusqu'à un statut
   stable à 2 ou 3, puis appuyer sur Entrée.
3. La calibration interne du capteur (accéléromètre/gyroscope/magnétomètre)
   est sauvegardée dans la mémoire flash de la puce — elle persiste après une
   coupure d'alimentation.
4. Viser précisément le repère de référence avec la caméra, puis entrer son
   relèvement connu quand l'outil le demande. L'outil mesure le cap actuel du
   capteur (moyenné sur ~1s) et calcule l'écart.
5. L'écart est écrit dans `imu.heading_offset_deg`
   (`/etc/pavois/pavois.conf`, sauvegardé avant modification) — aucune
   édition manuelle de fichier.
6. `pavois-imu.service` puis `pavois.service` sont redémarrés
   automatiquement pour appliquer le nouvel offset immédiatement.

Vérification : dans le frontend (panneau latéral, bloc IMU de la caméra), le
cap affiché doit correspondre au relèvement visé, à quelques degrés près. Si
les trois Pi sont calibrées de cette façon contre des repères dont le
relèvement réel est connu, elles doivent afficher le même cap à quelques
degrés près pour une même visée.

Pour re-caler uniquement le cap d'une caméra déjà bien calibrée (sans refaire
la manœuvre en huit) : `--skip-chip-calibration`.
