#!/usr/bin/env python3
"""
PAVOIS field IMU calibration tool.

Replaces the manual "edit imu.heading_offset_deg by hand, restart, look at
the map, repeat" workflow with a guided procedure:

  1. Stops pavois-imu.service (it holds the same I2C bus we need).
  2. Connects to the BNO08x directly (same bus/address as bno08x_bridge.py)
     and shows a live CALIB_STAT line while the operator performs the
     figure-eight maneuver.
  3. Saves the chip's own sensor calibration to flash.
  4. Asks for a known bearing the operator is sighting the camera at,
     measures the current heading, and computes the offset.
  5. Writes imu.heading_offset_deg into /etc/pavois/pavois.conf (backed up
     first), then restarts pavois-imu.service and pavois.service.

Run as root, with the same venv as bno08x_bridge.py:
  sudo /opt/pavois/imu-venv/bin/python /opt/pavois/pavois_imu_calib.py
"""

from __future__ import annotations

import argparse
import math
import os
import select
import subprocess
import sys
import time
from pathlib import Path

try:
    from adafruit_extended_bus import ExtendedI2C
    from adafruit_bno08x import BNO_REPORT_ROTATION_VECTOR
    from adafruit_bno08x.i2c import BNO08X_I2C
except ImportError as exc:
    print(
        f"Dependance manquante ({exc}). "
        "Lancer via /opt/pavois/imu-venv/bin/python, pas le python systeme.",
        file=sys.stderr,
    )
    raise SystemExit(1)

I2C_BUS = 1
I2C_ADDRESS = 0x4A  # meme bus/adresse que scripts/bno08x_bridge.py
IMU_SERVICE = "pavois-imu.service"
DETECT_SERVICE = "pavois.service"
DEFAULT_CONF = Path("/etc/pavois/pavois.conf")
HEADING_KEY = "imu.heading_offset_deg"


def quat_to_yaw_deg(x: float, y: float, z: float, w: float) -> float:
    """Cap en degres [0,360). Meme formule que bno08x_bridge.py (coherence
    obligatoire : c'est ce meme calcul que verra le systeme en production)."""
    norm = math.sqrt(x * x + y * y + z * z + w * w)
    if not math.isfinite(norm) or norm < 1e-6:
        raise ValueError("quaternion invalide (norme nulle)")
    x, y, z, w = x / norm, y / norm, z / norm, w / norm
    yaw = math.degrees(math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)))
    return yaw % 360.0


def wrap_offset_180(delta: float) -> float:
    """Wrap un delta de cap vers [-180, 180) - coherent avec wrap360(raw+offset)
    cote C++ (pavois/sensors/imu.cpp, apply_imu_offsets)."""
    return ((delta + 180.0) % 360.0) - 180.0


def systemctl(action: str, service: str, *, check: bool = True) -> None:
    try:
        subprocess.run(["systemctl", action, service], check=True)
    except subprocess.CalledProcessError:
        if check:
            raise
        print(f"Avertissement : 'systemctl {action} {service}' a echoue.", file=sys.stderr)


def wait_for_enter() -> None:
    while True:
        ready, _, _ = select.select([sys.stdin], [], [], 0.1)
        if ready:
            sys.stdin.readline()
            return


def live_calibration_loop(sensor) -> None:
    print(
        "\nEffectuez une maneuvre en huit avec la camera (mouvement large,\n"
        "les trois axes) jusqu'a un CALIB_STAT stable a 2 ou 3.\n"
        "Appuyez sur Entree quand c'est fait.\n"
    )
    while True:
        ready, _, _ = select.select([sys.stdin], [], [], 0.1)
        if ready:
            sys.stdin.readline()
            print()
            return
        try:
            x, y, z, w = sensor.quaternion
            yaw = quat_to_yaw_deg(x, y, z, w)
            status = sensor.calibration_status
            print(
                f"\rCALIB_STAT: {status}/3   cap actuel: {yaw:6.1f}deg   "
                "(Entree pour continuer)   ",
                end="",
                flush=True,
            )
        except Exception:
            print("\rCALIB_STAT: --/3   (lecture capteur en cours...)          ", end="", flush=True)


def measure_heading(sensor, samples: int = 20, interval: float = 0.05) -> float:
    """Cap moyen sur ~1s (moyenne circulaire) pour reduire le bruit capteur."""
    sin_sum = 0.0
    cos_sum = 0.0
    got = 0
    for _ in range(samples):
        try:
            x, y, z, w = sensor.quaternion
            yaw = quat_to_yaw_deg(x, y, z, w)
        except Exception:
            time.sleep(interval)
            continue
        sin_sum += math.sin(math.radians(yaw))
        cos_sum += math.cos(math.radians(yaw))
        got += 1
        time.sleep(interval)
    if got == 0:
        raise RuntimeError("Aucune lecture de cap valide recue du capteur.")
    return math.degrees(math.atan2(sin_sum, cos_sum)) % 360.0


def prompt_known_bearing() -> float:
    while True:
        raw = input(
            "\nVisez precisement un repere dont le relevement (cap reel,\n"
            "0-360deg) est connu, puis entrez ce relevement : "
        ).strip()
        try:
            value = float(raw)
        except ValueError:
            print("Entrer un nombre entre 0 et 360.")
            continue
        if 0.0 <= value < 360.0:
            return value
        print("Entrer un nombre entre 0 et 360.")


def write_heading_offset(conf_path: Path, offset_deg: float) -> None:
    if not conf_path.exists():
        raise FileNotFoundError(f"{conf_path} introuvable.")

    backup_path = conf_path.with_name(f"{conf_path.name}.before-imu-calib-{int(time.time())}")
    backup_path.write_bytes(conf_path.read_bytes())
    print(f"Sauvegarde : {backup_path}")

    lines = conf_path.read_text().splitlines(keepends=True)
    new_line = f"{HEADING_KEY}={offset_deg:.3f}\n"
    replaced = False
    out_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith(f"{HEADING_KEY}=") or stripped.startswith(f"{HEADING_KEY} ="):
            out_lines.append(new_line)
            replaced = True
        else:
            out_lines.append(line)
    if not replaced:
        if out_lines and not out_lines[-1].endswith("\n"):
            out_lines.append("\n")
        out_lines.append(new_line)

    tmp_path = conf_path.with_suffix(conf_path.suffix + ".tmp")
    tmp_path.write_text("".join(out_lines))
    os.replace(tmp_path, conf_path)
    print(f"{HEADING_KEY}={offset_deg:.3f} ecrit dans {conf_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Calibration terrain BNO08x (PAVOIS).")
    parser.add_argument("--conf", type=Path, default=DEFAULT_CONF)
    parser.add_argument(
        "--skip-chip-calibration",
        action="store_true",
        help="Ne pas refaire la maneuvre en huit / save_calibration_data, "
        "juste re-mesurer et ecrire l'offset de cap.",
    )
    args = parser.parse_args()

    if os.geteuid() != 0:
        print(
            "Ce script doit etre lance avec sudo (systemctl + ecriture /etc/pavois/).",
            file=sys.stderr,
        )
        return 1

    print(f"Arret de {IMU_SERVICE} pour liberer le bus I2C...")
    systemctl("stop", IMU_SERVICE)

    known_bearing: float | None = None
    try:
        i2c = ExtendedI2C(I2C_BUS)
        sensor = BNO08X_I2C(i2c, address=I2C_ADDRESS)
        sensor.enable_feature(BNO_REPORT_ROTATION_VECTOR)
        time.sleep(0.5)

        if not args.skip_chip_calibration:
            live_calibration_loop(sensor)
            try:
                sensor.save_calibration_data()
                print("Calibration de la puce sauvegardee en memoire flash.")
            except Exception as exc:
                print(
                    f"Avertissement : sauvegarde de la calibration puce echouee ({exc}). "
                    "On continue quand meme avec la mesure de cap.",
                    file=sys.stderr,
                )
        else:
            print("Calibration puce ignoree (--skip-chip-calibration).")

        known_bearing = prompt_known_bearing()
        print("Mesure du cap en cours (~1s)...")
        measured = measure_heading(sensor)
        offset = wrap_offset_180(known_bearing - measured)
        print(
            f"Cap mesure: {measured:.1f}deg  Relevement vise: {known_bearing:.1f}deg  "
            f"Offset a appliquer: {offset:+.1f}deg"
        )

        write_heading_offset(args.conf, offset)

    except KeyboardInterrupt:
        print("\nInterrompu par l'operateur.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"\nErreur pendant la calibration : {exc}", file=sys.stderr)
        return 1
    finally:
        print(f"Redemarrage de {IMU_SERVICE}...")
        systemctl("start", IMU_SERVICE, check=False)

    print(f"Redemarrage de {DETECT_SERVICE} pour appliquer le nouvel offset...")
    systemctl("restart", DETECT_SERVICE, check=False)

    print(
        "\nTermine. Verifiez dans le frontend (panneau lateral) que le cap "
        f"affiche pour cette camera correspond a ~{known_bearing:.1f}deg en visant "
        "le meme repere."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
