#!/usr/bin/env python3
"""
Pavois — page web unique : les flux camera (MJPEG) + les IMU BNO085 en direct,
pour TOUS les Pi du montage (Phase 1 = 2 cameras).

Ce meme fichier tourne sur CHAQUE Pi, a l'identique :
  - il sert son propre /imu (le capteur branche sur CE Pi-la) ;
  - il sait servir la page complete, qui affiche tous les noeuds listes dans
    NODES ci-dessous.
Donc n'importe lequel des deux Pi peut servir de "tableau de bord" : le
navigateur va chercher chaque video et chaque IMU directement sur le Pi
concerne, rien ne transite deux fois, aucun Pi n'est un relais.

Architecture par Pi (2 processus, volontairement separes) :
  - camstream.sh : rpicam-vid -> ffmpeg, sert la VIDEO seule sur le port 8081
    en -c copy (aucun re-encodage, CPU quasi nul sur le Pi).
  - ce script    : sert la PAGE et le JSON /imu sur le port 8080. Il ne touche
    jamais aux images -> une IMU qui plante ne peut pas faire tomber la video,
    et inversement.

URLs (sur chaque Pi) :
  http://<pi>:8080/       -> la page complete (toutes les cameras + IMU)
  http://<pi>:8080/imu    -> JSON brut de l'IMU de CE Pi
  http://<pi>:8081/stream -> la video seule de CE Pi

Lancement :
  python3 ~/pavois_web.py
  (ou en detache : nohup python3 ~/pavois_web.py > /tmp/pavois_web.log 2>&1 &)
"""

import json
import math
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---------------------------------------------------------------- config ----

WEB_PORT = 8080          # page + JSON /imu de CE Pi

# Les noeuds du montage. LISTE IDENTIQUE SUR TOUS LES PI : c'est elle qui decrit
# l'installation complete, pas "les autres Pi vus depuis celui-ci".
#   host  -> ADRESSE IP, pas le nom mDNS. Windows resout "jean.local" en IPv6
#            publique, or les serveurs (page et ffmpeg) n'ecoutent qu'en IPv4 :
#            le navigateur tenterait l'IPv6 et echouerait. En ssh on contourne
#            avec AddressFamily inet, mais pas dans un navigateur.
#            -> si le DHCP change une IP, c'est cette ligne qu'on corrige.
#   imu   -> ce noeud a une BNO085 branchee (on ira lire son /imu)
NODES = [
    # pi5 a DEUX adresses : .60 en Ethernet, .94 en Wi-Fi. On pointe le Wi-Fi :
    # c'est celle qui subsiste si le cable est debranche (et elle reste
    # valable cable branche, les deux interfaces etant actives).
    {"name": "cam0 — pi5",      "host": "192.168.1.94", "video_port": 8081,
     "path": "/stream", "web_port": 8080, "imu": True},
    {"name": "cam1 — pi-walid", "host": "192.168.1.13", "video_port": 8081,
     "path": "/stream", "web_port": 8080, "imu": True},
    {"name": "cam2 — pi-tanel", "host": "192.168.1.83", "video_port": 8081,
     "path": "/stream", "web_port": 8080, "imu": True},
]

# Nom du noeud correspondant a CE Pi (doit matcher un "name" ci-dessus).
# Sert seulement a l'affichage — la page marche meme s'il est faux.
LOCAL_NODE = "cam0 — pi5"

# "i2c"  : cablage SDA/SCL classique. Simple, mais le BNO085 a besoin de
#          "clock stretching" que le Pi gere mal -> on descend a 100 kHz et il
#          peut quand meme y avoir des lectures ratees (elles sont ignorees).
# "uart" : mode UART-RVC (PS1 a 3.3V sur la carte Adafruit). Beaucoup plus
#          fiable sur Raspberry Pi, sort directement yaw/pitch/roll a 100 Hz.
#          C'est le mode recommande si les chiffres sautent en I2C.
IMU_MODE = "i2c"

I2C_ADDRESS = 0x4A       # 0x4B si le pont d'adresse de la carte est ponte

# ATTENTION : sous Linux, cet argument est IGNORE par Blinka. La vraie vitesse
# du bus se regle dans /boot/firmware/config.txt :
#     dtparam=i2c_arm=on,i2c_arm_baudrate=50000
# Sur Raspberry Pi 4, a la vitesse par defaut (100 kHz) le flux du BNO085
# arrive corrompu (KeyError dans la lib, valeurs figees alors que le compteur
# de lectures monte). A 50 kHz : 0 erreur, valeurs qui evoluent. Verifie le
# 2026-08-03 sur le Pi 4 "walid". Le Pi 5 n'a pas ce defaut.
I2C_FREQUENCY = 100000
UART_DEVICE = "/dev/serial0"
UART_BAUD = 115200

POLL_HZ = 20             # frequence de lecture du capteur


# ------------------------------------------------------------ etat global ----

_state = {
    "ok": False,
    "error": "demarrage...",
    "mode": IMU_MODE,
    "t": 0.0,
    "yaw": None, "pitch": None, "roll": None,
    "quat": None,          # [i, j, k, real] — seulement en I2C
    "accel": None,         # [x, y, z] m/s^2
    "gyro": None,          # [x, y, z] rad/s
    "calib": None,         # 0..3 (0 = pas calibre, 3 = bien calibre)
    "reads": 0, "errors": 0,
}
_lock = threading.Lock()


def _publish(**kw):
    with _lock:
        _state.update(kw)
        _state["t"] = time.time()


def _snapshot():
    with _lock:
        return dict(_state)


def quat_to_euler(i, j, k, r):
    """Quaternion BNO085 (i,j,k,real) -> yaw/pitch/roll en degres.

    Convention : roll = rotation autour de X, pitch = autour de Y,
    yaw = autour de Z (cap). Meme convention que le mode UART-RVC.
    """
    # roll (X)
    sinr = 2.0 * (r * i + j * k)
    cosr = 1.0 - 2.0 * (i * i + j * j)
    roll = math.degrees(math.atan2(sinr, cosr))
    # pitch (Y) — clamp pour eviter un NaN au zenith
    sinp = 2.0 * (r * j - k * i)
    sinp = max(-1.0, min(1.0, sinp))
    pitch = math.degrees(math.asin(sinp))
    # yaw (Z)
    siny = 2.0 * (r * k + i * j)
    cosy = 1.0 - 2.0 * (j * j + k * k)
    yaw = math.degrees(math.atan2(siny, cosy))
    return yaw, pitch, roll


# --------------------------------------------------------- lecture du BNO ----

def imu_loop_i2c():
    try:
        import board
        import busio
        from adafruit_bno08x import (
            BNO_REPORT_ACCELEROMETER,
            BNO_REPORT_GYROSCOPE,
            BNO_REPORT_ROTATION_VECTOR,
        )
        from adafruit_bno08x.i2c import BNO08X_I2C
    except ImportError as e:
        _publish(ok=False, error=f"librairie manquante : {e}. "
                                 "pip3 install adafruit-circuitpython-bno08x")
        return

    # Le bus est ouvert UNE seule fois. Le rouvrir a chaque tentative laissait
    # des objets busio empiles, et le scan renvoyait alors n'importe quoi (d'ou
    # des messages d'erreur incoherents quand rien n'est branche).
    try:
        i2c = busio.I2C(board.SCL, board.SDA, frequency=I2C_FREQUENCY)
    except Exception as e:
        _publish(ok=False, error=f"bus I2C indisponible ({type(e).__name__}: {e}). "
                                 "I2C active ? sudo raspi-config > Interface "
                                 "Options > I2C, puis redemarrer.")
        return

    def scan_bus():
        while not i2c.try_lock():
            time.sleep(0.01)
        try:
            return i2c.scan()
        finally:
            i2c.unlock()

    period = 1.0 / POLL_HZ
    while True:
        # 1) Y a-t-il seulement quelqu'un au bout du fil ? Sans ce test, une
        #    carte absente remonte une erreur interne incomprehensible.
        found = scan_bus()
        if I2C_ADDRESS not in found:
            seen = ", ".join(hex(a) for a in found) if found else "rien"
            _publish(ok=False,
                     error=f"aucun BNO085 en {hex(I2C_ADDRESS)} sur le bus I2C "
                           f"(detecte : {seen}). Verifier le cablage "
                           "SDA->GPIO2, SCL->GPIO3, 3V3, GND — ou essayer "
                           "l'adresse 0x4B.")
            time.sleep(3.0)
            continue

        # 2) Le capteur repond : on l'initialise.
        try:
            bno = BNO08X_I2C(i2c, address=I2C_ADDRESS)
            bno.enable_feature(BNO_REPORT_ROTATION_VECTOR)
            bno.enable_feature(BNO_REPORT_ACCELEROMETER)
            bno.enable_feature(BNO_REPORT_GYROSCOPE)
            _publish(ok=True, error=None)
        except Exception as e:
            _publish(ok=False,
                     error=f"capteur present en {hex(I2C_ADDRESS)} mais "
                           f"initialisation refusee ({type(e).__name__}). "
                           "Typique du clock stretching sur Pi : passer "
                           "IMU_MODE = \"uart\" en haut du script.")
            time.sleep(3.0)
            continue

        # Boucle de lecture. Le BNO085 rate regulierement des transactions I2C
        # sur un Pi (clock stretching) : on compte les erreurs et on continue,
        # on ne re-initialise que si ca devient systematique.
        consecutive = 0
        while True:
            t0 = time.time()
            try:
                i, j, k, r = bno.quaternion
                yaw, pitch, roll = quat_to_euler(i, j, k, r)
                ax, ay, az = bno.acceleration
                gx, gy, gz = bno.gyro
                try:
                    calib = bno.calibration_status
                except Exception:
                    calib = None
                with _lock:
                    _state["reads"] += 1
                _publish(ok=True, error=None,
                         yaw=yaw, pitch=pitch, roll=roll,
                         quat=[i, j, k, r],
                         accel=[ax, ay, az], gyro=[gx, gy, gz],
                         calib=calib)
                consecutive = 0
            except Exception as e:
                consecutive += 1
                with _lock:
                    _state["errors"] += 1
                if consecutive >= 20:
                    _publish(ok=False,
                             error=f"20 lectures ratees ({type(e).__name__}) "
                                   "-> reinitialisation du capteur")
                    break
            dt = period - (time.time() - t0)
            if dt > 0:
                time.sleep(dt)


def imu_loop_uart():
    try:
        import serial
        from adafruit_bno08x_rvc import BNO08x_RVC
    except ImportError as e:
        _publish(ok=False, error=f"librairie manquante : {e}. "
                                 "pip3 install adafruit-circuitpython-bno08x-rvc "
                                 "pyserial")
        return

    while True:
        try:
            uart = serial.Serial(UART_DEVICE, UART_BAUD, timeout=1.0)
            rvc = BNO08x_RVC(uart)
            _publish(ok=True, error=None)
        except Exception as e:
            _publish(ok=False, error=f"init UART : {type(e).__name__}: {e}")
            time.sleep(2.0)
            continue

        while True:
            try:
                yaw, pitch, roll, ax, ay, az = rvc.heading
                with _lock:
                    _state["reads"] += 1
                _publish(ok=True, error=None,
                         yaw=yaw, pitch=pitch, roll=roll,
                         quat=None, accel=[ax, ay, az], gyro=None,
                         calib=None)
            except Exception as e:
                with _lock:
                    _state["errors"] += 1
                _publish(ok=False, error=f"lecture UART : {type(e).__name__}: {e}")
                time.sleep(0.5)
                break


# ------------------------------------------------------------- page HTML ----

PAGE = """<!doctype html>
<meta charset="utf-8">
<title>Pavois — cameras + IMU</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#111; color:#eee;
         font:14px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; }
  header { padding:14px 16px 0; color:#777; font-size:12px;
           letter-spacing:.1em; text-transform:uppercase; }
  .grid { display:grid; gap:16px; padding:16px;
          grid-template-columns:repeat(auto-fit,minmax(420px,1fr)); }
  .node { border:1px solid #2a2a2a; border-radius:8px; overflow:hidden;
          background:#161616; }
  .node > h2 { margin:0; padding:10px 12px; font-size:13px; font-weight:600;
               letter-spacing:.04em; text-transform:none; color:#ddd;
               background:#1c1c1c; border-bottom:1px solid #2a2a2a;
               display:flex; align-items:center; gap:8px; }
  .node h2 .host { margin-left:auto; color:#666; font-size:11px;
                   font-weight:400; }
  .dot { width:9px; height:9px; border-radius:50%; background:#555;
         flex:0 0 auto; }
  .up   .dot { background:#8fe0a4; }
  .down .dot { background:#ff6b6b; }
  .node img { width:100%; display:block; aspect-ratio:16/9; object-fit:cover;
              background:#000; }
  .node.down img { opacity:.3; }
  .imu { padding:12px; }
  .status { padding:7px 9px; border-radius:5px; margin-bottom:11px;
            font-size:12px; line-height:1.35; }
  .ok  { background:#16301c; color:#8fe0a4; }
  .bad { background:#331a1a; color:#ff9d9d; }
  .rpy { display:grid; grid-template-columns:repeat(3,1fr); gap:8px;
         margin-bottom:12px; }
  .rpy div { background:#101010; border:1px solid #262626; border-radius:6px;
             padding:8px 6px; text-align:center; }
  .rpy span { display:block; color:#7a7a7a; font-size:11px;
              text-transform:uppercase; letter-spacing:.08em; }
  .rpy b { font-size:22px; font-weight:600; color:#7fd4ff;
           font-variant-numeric:tabular-nums; }
  table { width:100%; border-collapse:collapse; }
  td { padding:3px 6px; border-bottom:1px solid #222; font-size:12px; }
  td.k { color:#7a7a7a; }
  td.v { text-align:right; font-variant-numeric:tabular-nums; }
  .bar { height:5px; background:#242424; border-radius:3px; overflow:hidden;
         margin-top:9px; }
  .bar > i { display:block; height:100%; background:#7fd4ff; width:0;
             transition:width .3s; }
  .hint { color:#6d6d6d; font-size:11px; padding:0 16px 20px; }
</style>
<header>Pavois — banc 2 cameras</header>
<div class="grid" id="grid"></div>
<div class="hint">
  Calibration IMU : bouger le capteur en forme de huit dans l'air jusqu'a ce que
  la jauge soit pleine (3/3). Le yaw n'est fiable qu'a partir de 2/3.
  L'IMU mesure son propre boitier, pas l'axe optique : il reste un decalage
  fixe du a l'inclinaison de la plaque, a mesurer une fois et a soustraire.
</div>
<script>
  const NODES = __NODES__;
  const LOCAL = __LOCAL__;

  const f = (v, n) => (v === null || v === undefined) ? '—' : v.toFixed(n);

  // Une carte par Pi : sa video, puis ses chiffres IMU juste en dessous. Les
  // deux sont lus DIRECTEMENT sur le Pi concerne, la page ne fait que les
  // afficher cote a cote.
  const grid = document.getElementById('grid');
  NODES.forEach((n, i) => {
    const host = n.host || location.hostname;
    const vurl = location.protocol + '//' + host + ':' + n.video_port + n.path;

    const card = document.createElement('section');
    card.className = 'node';
    card.innerHTML =
      '<h2><i class="dot"></i>' + n.name +
        (n.name === LOCAL ? ' <em style="font-style:normal;color:#666">(ce Pi)</em>' : '') +
        '<span class="host">' + host + '</span></h2>' +
      '<img alt="' + n.name + '">' +
      (n.imu ? (
        '<div class="imu">' +
        '<div class="status" id="st' + i + '">connexion...</div>' +
        '<div class="rpy">' +
          '<div><span>yaw</span><b id="yaw' + i + '">—</b></div>' +
          '<div><span>pitch</span><b id="pitch' + i + '">—</b></div>' +
          '<div><span>roll</span><b id="roll' + i + '">—</b></div>' +
        '</div>' +
        '<table>' +
          '<tr><td class="k">accel x/y/z (m/s²)</td><td class="v" id="acc' + i + '">—</td></tr>' +
          '<tr><td class="k">gyro x/y/z (rad/s)</td><td class="v" id="gyr' + i + '">—</td></tr>' +
          '<tr><td class="k">mode</td><td class="v" id="mode' + i + '">—</td></tr>' +
          '<tr><td class="k">lectures / erreurs</td><td class="v" id="cnt' + i + '">—</td></tr>' +
        '</table>' +
        '<div class="bar"><i id="cal' + i + '"></i></div>' +
        '</div>'
      ) : '<div class="imu"><div class="status bad">pas d\\'IMU sur ce noeud</div></div>');
    grid.appendChild(card);

    // --- video ---
    const img = card.querySelector('img');
    // ?t= : empeche le navigateur de ressortir une image figee du cache.
    const load = () => { img.src = vurl + '?t=' + Date.now(); };
    // Un flux MJPEG ne "finit" jamais : onload se declenche au 1er octet utile.
    // onerror = Pi eteint ou camstream arrete -> on retente toutes les 5 s, la
    // vignette se rallume toute seule quand le Pi revient.
    img.onload  = () => { card.classList.remove('down');
                          card.classList.add('up'); };
    img.onerror = () => { card.classList.remove('up');
                          card.classList.add('down');
                          setTimeout(load, 5000); };
    load();

    // --- IMU ---
    if (!n.imu) return;
    const el = id => document.getElementById(id + i);
    // Meme hote que la page -> URL relative (pas de souci d'origine). Autre Pi
    // -> URL absolue, d'ou l'en-tete CORS cote serveur.
    const iurl = (n.host && n.host !== location.hostname)
        ? location.protocol + '//' + host + ':' + n.web_port + '/imu'
        : '/imu';

    async function tick() {
      try {
        const d = await (await fetch(iurl, {cache:'no-store'})).json();
        const s = el('st');
        if (d.ok) { s.className = 'status ok'; s.textContent = 'IMU connectee'; }
        else { s.className = 'status bad'; s.textContent = d.error || 'IMU indisponible'; }

        el('yaw').textContent   = f(d.yaw, 1)   + (d.yaw   != null ? '°' : '');
        el('pitch').textContent = f(d.pitch, 1) + (d.pitch != null ? '°' : '');
        el('roll').textContent  = f(d.roll, 1)  + (d.roll  != null ? '°' : '');

        const a = d.accel || [null,null,null], g = d.gyro || [null,null,null];
        el('acc').textContent = f(a[0],2)+' / '+f(a[1],2)+' / '+f(a[2],2);
        el('gyr').textContent = f(g[0],3)+' / '+f(g[1],3)+' / '+f(g[2],3);
        el('mode').textContent = d.mode +
            ((d.calib === null || d.calib === undefined) ? '' : '  ·  calib ' + d.calib + '/3');
        el('cnt').textContent  = d.reads + ' / ' + d.errors;
        el('cal').style.width  = ((d.calib || 0) / 3 * 100) + '%';
      } catch (e) {
        const s = el('st');
        s.className = 'status bad';
        s.textContent = 'pas de reponse de ' + host + ':' + n.web_port +
                        ' (Pi eteint, ou pavois_web.py pas lance dessus)';
      }
    }
    tick();
    setInterval(tick, 200);
  });
</script>
"""


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass  # pas de spam : la page interroge /imu 5 fois par seconde

    def _send(self, body, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        # La page servie par un Pi lit le /imu de l'AUTRE Pi : sans cet en-tete
        # le navigateur bloque la requete (origine differente). Reseau local
        # prive, pas de donnee sensible -> "*" convient.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html"):
            html = (PAGE
                    .replace("__NODES__", json.dumps(NODES))
                    .replace("__LOCAL__", json.dumps(LOCAL_NODE)))
            self._send(html.encode("utf-8"), "text/html; charset=utf-8")
        elif path == "/imu":
            self._send(json.dumps(_snapshot()).encode("utf-8"),
                       "application/json")
        else:
            self.send_error(404)


def main():
    loop = imu_loop_uart if IMU_MODE == "uart" else imu_loop_i2c
    threading.Thread(target=loop, daemon=True).start()
    srv = ThreadingHTTPServer(("0.0.0.0", WEB_PORT), Handler)
    print(f"page : http://0.0.0.0:{WEB_PORT}/   (ce noeud = {LOCAL_NODE})")
    for n in NODES:
        host = n["host"] or "<meme hote>"
        print(f"  {n['name']}: video {host}:{n['video_port']}{n['path']}"
              f"{'  + imu ' + host + ':' + str(n['web_port']) + '/imu' if n['imu'] else ''}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
