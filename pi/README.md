# Pavois — cameras + IMU en direct

Une page web qui montre **toutes les cameras du banc et leurs IMU BNO085 cote a
cote**, mises a jour 5 fois par seconde.

Banc actuel — 3 noeuds, chacun avec sa camera OV5647 et son IMU :

| noeud | ssh | carte | IP |
|---|---|---|---|
| cam0 | `pi5` | Pi 5 | 192.168.1.60 |
| cam1 | `pi-walid` | Pi 4 | 192.168.1.13 |
| cam2 | `pi-tanel` | Pi 4 | 192.168.1.83 |

```
http://<pi>:8080/        <- la page complete (toutes les cameras + IMU)
http://<pi>:8080/imu     <- JSON de l'IMU de CE Pi
http://<pi>:8081/stream  <- video seule de CE Pi
```

## Le principe

`pavois_web.py` tourne sur **chaque** Pi, avec le meme fichier. Chaque Pi sert
sa propre video (port 8081) et sa propre IMU (port 8080 `/imu`). La page, elle,
est identique partout et affiche **tous** les noeuds listes dans `NODES`.

Consequence pratique : tu ouvres la page sur n'importe lequel des deux Pi, tu
vois les deux cameras. Le navigateur va chercher chaque flux directement sur le
Pi concerne — aucun Pi ne relaie la video d'un autre, donc pas de Pi qui rame
parce qu'il fait le facteur.

Configuration, en haut de `pavois_web.py` :

```python
NODES = [
    {"name": "cam0 — pi5",      "host": "jean.local",   "video_port": 8081,
     "path": "/stream", "web_port": 8080, "imu": True},
    {"name": "cam1 — pi-walid", "host": "192.168.1.13", "video_port": 8081,
     "path": "/stream", "web_port": 8080, "imu": True},
]
LOCAL_NODE = "cam0 — pi5"   # a changer sur le 2e Pi : "cam1 — pi-walid"
```

`NODES` doit etre **identique sur les deux Pi**. Seul `LOCAL_NODE` change (il
sert juste a marquer "(ce Pi)" dans le titre de la carte).

Un noeud injoignable n'empeche rien : sa vignette passe en rouge, retente toute
seule toutes les 5 s, et se rallume quand le Pi revient.

## Pourquoi les chiffres sont a cote de l'image et pas dessus

La video n'est pas retouchee : `ffmpeg` la recopie telle quelle (`-c copy`), le
Pi ne calcule quasiment rien. Ecrire les chiffres **dans** l'image obligerait a
tout re-encoder image par image, et salirait des images qui servent aussi a la
calibration optique.

## Cablage de l'IMU

Le BNO085 doit etre relie au Pi. Deux options, **et le choix compte** :

| | I2C | UART-RVC |
|---|---|---|
| cablage | SDA -> broche 3 (GPIO2), SCL -> broche 5 (GPIO3), 3V3 -> broche 1, GND -> broche 6 | TX -> GPIO15 (RXD), 3V3, GND, **PS1 a 3.3V** |
| a activer | `sudo raspi-config nonint do_i2c 0` puis redemarrer | `enable_uart=1` + liberer la console serie |
| fiabilite | moyenne : le BNO085 a besoin de "clock stretching" que le Pi gere mal | bonne, c'est le mode conseille sur Pi |
| donnees | quaternion + accel + gyro + etat de calibration | yaw/pitch/roll + accel a 100 Hz |

Par defaut le script est en I2C. Verification du cablage, sur le Pi :

```sh
/usr/sbin/i2cdetect -y 1     # le BNO085 doit apparaitre en 4a (ou 4b)
```

### Vitesse du bus I2C — indispensable sur Pi 4

Sur le Pi 4 (`walid`), a la vitesse par defaut de 100 kHz, le flux du BNO085
arrive **corrompu** : la lib leve `KeyError: 123`, et via la page les valeurs
restent figees au 15e chiffre pres alors que le compteur de lectures monte
normalement (le capteur repond, mais ses trames sont illisibles).

Correctif, dans `/boot/firmware/config.txt`, puis redemarrer :

```
dtparam=i2c_arm=on,i2c_arm_baudrate=50000
```

Mesure avant/apres sur le Pi 4, test de 12 s (2026-08-03) :

| | lectures | erreurs | quaternions distincts |
|---|---|---|---|
| 100 kHz (defaut) | — | plantage `KeyError` | 1 (valeur figee) |
| 50 kHz | 91 | 0 | 66 |

Piege : l'argument `frequency=` de `busio.I2C()` est **ignore** sous Linux —
la vitesse vient du device tree, donc de `config.txt`. Le regler dans le code
ne sert a rien.

Le Pi 5 n'a pas ce defaut (puce I2C differente), le reglage n'y est pas
necessaire. Si malgre les 50 kHz les valeurs se figent encore, alors seulement
recabler en UART-RVC et passer `IMU_MODE = "uart"`.

## Installation sur un Pi

```sh
sudo raspi-config nonint do_i2c 0          # active l'I2C
sudo apt install -y i2c-tools
pip3 install --break-system-packages adafruit-circuitpython-bno08x
# variante UART : ... adafruit-circuitpython-bno08x-rvc pyserial
sudo reboot                                 # obligatoire pour l'I2C
```

Copier les fichiers depuis le PC :

```powershell
scp "$env:USERPROFILE\Documents\Side-Project\Pavois\pi\camstream.sh"  <pi>:~/camstream.sh
scp "$env:USERPROFILE\Documents\Side-Project\Pavois\pi\pavois_web.py" <pi>:~/pavois_web.py
ssh <pi> "chmod +x ~/camstream.sh"
```

## Lancement

**Deux commandes ssh SEPAREES** — ne jamais mettre le `pkill` et le `nohup` dans
la meme commande : le motif du `pkill` retrouve le texte de la commande ssh
elle-meme et tue la session (erreur 255).

```sh
ssh <pi> "pkill -f '[c]amstream'; pkill -f '[p]avois_web'; sleep 1; echo ok"
ssh <pi> "nohup ~/camstream.sh > /tmp/cs.log 2>&1 </dev/null & nohup python3 ~/pavois_web.py > /tmp/pw.log 2>&1 </dev/null & sleep 3; echo lance"
```

Puis ouvrir `http://<pi>:8080/`.

## Si ca ne marche pas

- **Vignette rouge** : ce Pi-la est eteint, ou `camstream.sh` n'y tourne pas
  (`ssh <pi> "cat /tmp/cs.log"`).
- **"pas de reponse de <hote>:8080"** sous une camera : `pavois_web.py` n'est
  pas lance sur CE Pi-la.
- **"aucun BNO085 en 0x4a"** : rien sur le bus -> revoir le cablage, ou essayer
  l'adresse `0x4B`.
- **"initialisation refusee"**, ou valeurs figees alors que le compteur de
  lectures monte : c'est le clock stretching -> voir "Vitesse du bus I2C"
  ci-dessus (50 kHz dans `config.txt`), et seulement ensuite l'UART-RVC.
- **Une video ne s'affiche que dans un seul onglet** : normal, `-listen 1` = un
  seul spectateur par camera. Un 2e onglet (ou un `curl`) sur le meme flux
  echoue tant que le premier est connecte.

- **L'IMU s'affiche mais plus la video, apres un changement de reseau**
  (cable Ethernet debranche, bascule Wi-Fi) : le client etait connecte sur
  l'ANCIENNE adresse. Debrancher ne ferme pas la connexion TCP proprement —
  elle survit dans le noyau avec des donnees non acquittees. Comme
  `-listen 1` n'accepte qu'un client, ffmpeg se croit occupe par ce fantome
  et refuse le nouveau. L'IMU, elle, passe : c'est une connexion neuve sur un
  autre port.

  Diagnostic — une ligne sur une adresse qui n'existe plus, avec un gros
  Send-Q :
  ```sh
  ssh <pi> "ss -tn '( sport = :8081 )'"
  ssh <pi> "hostname -I"        # l'adresse du socket n'y figure plus
  ```
  Deblocage immediat (la boucle relance ffmpeg toute seule) :
  ```sh
  ssh <pi> "pkill -x ffmpeg"    # -x = nom exact, ne peut pas tuer sa propre session ssh
  ```
  Prevention, deja en place sur les 3 Pi (`/etc/sysctl.d/99-pavois-tcp.conf`) :
  `net.ipv4.tcp_retries2 = 8` fait abandonner TCP en ~100 s au lieu de ~15 min,
  donc le flux se retablit seul. `sudo ss -K` ne marche pas sur ces sockets
  (le noyau refuse : `RTNETLINK answers: Invalid argument`).
- **"librairie manquante"** : le `pip3 install` n'a pas ete fait ; le message
  donne la commande exacte.
- **yaw qui derive** : normal tant que la jauge de calibration n'est pas a 2 ou
  3 sur 3.

## Lien avec le reste de Pavois

Le yaw/pitch/roll affiche est exactement ce que `metadata.json` attend pour
chaque camera (voir `PLAN.md`) : ca remplace le `yaw=0, pitch=90` ecrit en dur.

Attention : l'IMU mesure **son propre boitier**, pas l'axe optique. Elle est
vissee a plat, la camera est sur la plaque inclinee du support — il reste donc
un decalage fixe entre les deux. Il se mesure une fois et se soustrait : c'est
un angle constant, pas une derive.
