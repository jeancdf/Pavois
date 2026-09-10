# Déploiement sur les Raspberry Pi

Le programme capture la caméra CSI **locale**, détecte les mouvements et envoie
les observations au VPS en UDP. Le frontend reste sur le VPS. Une Pi avec une
caméra émet actuellement des détections 2D `raw` ; la fusion 3D entre plusieurs Pi,
la lecture de l'IMU par le C++ et le réglage GPS depuis le frontend restent des
développements séparés.

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

Renseigner `output_host` avec l'adresse réelle du VPS et `output_port=41234`.
Le script attribue le nom de la Pi à `camera.0.id` : garder des identifiants
différents sur chaque Pi. La caméra est sélectionnée par `camera.0.device=csi:0`,
à comparer avec `rpicam-hello --list-cameras`. Le modèle de configuration propose
1280×720 à 10 images/s pour les Pi 4 ; Jean (Pi 5) est réglé à 20 images/s.
`camera.0.fps` règle la cadence demandée à la caméra CSI. À 20 images/s demandées,
le traitement mesuré sur Walid plafonnait autour de 11–12 images/s : une cadence
de 10 évite de demander plus d'images que le détecteur ne peut en traiter.

Le script installe les dépendances, le compte de service `pavois` et le service
systemd. Il autorise le compte de déploiement à remplacer le binaire et à
redémarrer uniquement ce service via sudo. Les valeurs GPS et l'orientation
restent pour l'instant configurables manuellement dans ce fichier.

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
