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
  sudo /opt/pavois/imu-venv/bin/python /opt/pavois/bin/calib.py
"""

from __future__ import annotations

import argparse
import math
import os
import select
import subprocess
import sys
import time
import warnings
from pathlib import Path

# Blinka emits this warning on every Linux I2C open even though the requested
# frequency is irrelevant here. It hides the useful field-calibration output.
warnings.filterwarnings(
    "ignore",
    message=r"I2C frequency is not settable in python, ignoring!",
    category=RuntimeWarning,
)

try:
    from adafruit_extended_bus import ExtendedI2C
    from adafruit_bno08x import (
        BNO_REPORT_MAGNETOMETER,
        BNO_REPORT_ROTATION_VECTOR,
        _report_length,
    )
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
SENSOR_OPEN_ATTEMPTS = 5


class CalibrationBNO08X(BNO08X_I2C):
    """BNO08x driver tolerant of unsolicited/malformed SHTP batches.

    Some BNO08x firmware revisions occasionally put an unknown report in a
    batched PRODUCT_ID_RESPONSE. Version 1.3.3 of the Adafruit driver raises a
    bare KeyError (for example ``120`` for report 0x78) and dumps the complete
    packet to stdout. Ignoring that one bad batch is safe: feature setup waits
    for its own acknowledgement and will time out normally if communication is
    genuinely broken.
    """

    def __init__(self, *args, **kwargs) -> None:
        self.ignored_packet_count = 0
        super().__init__(*args, **kwargs)

    def _handle_packet(self, packet) -> None:
        """Process every valid report before discarding a corrupt remainder."""
        next_byte = 0
        data_length = len(packet.data)
        while next_byte < data_length:
            report_id = packet.data[next_byte]
            try:
                required_bytes = _report_length(report_id)
            except (KeyError, IndexError):
                self.ignored_packet_count += 1
                return

            if data_length - next_byte < required_bytes:
                self.ignored_packet_count += 1
                return

            report = packet.data[next_byte : next_byte + required_bytes]
            try:
                self._process_report(report_id, report)
            except (KeyError, IndexError, ValueError, RuntimeError):
                self.ignored_packet_count += 1
            next_byte += required_bytes


def normalize_quaternion(
    x: float, y: float, z: float, w: float
) -> tuple[float, float, float, float]:
    norm = math.sqrt(x * x + y * y + z * z + w * w)
    if not math.isfinite(norm) or norm < 1e-6:
        raise ValueError("quaternion invalide (norme nulle)")
    return x / norm, y / norm, z / norm, w / norm


class MotionCoverage:
    """Accumulate actual rotation received from the IMU on its three axes."""

    def __init__(self) -> None:
        self.previous: tuple[float, float, float, float] | None = None
        self.rotation_deg = [0.0, 0.0, 0.0]

    def update(self, quaternion: tuple[float, float, float, float]) -> None:
        current = normalize_quaternion(*quaternion)
        if self.previous is None:
            self.previous = current
            return

        px, py, pz, pw = self.previous
        x, y, z, w = current
        # Relative rotation: conjugate(previous) * current.
        rx = pw * x - px * w - py * z + pz * y
        ry = pw * y + px * z - py * w - pz * x
        rz = pw * z - px * y + py * x - pz * w
        rw = pw * w + px * x + py * y + pz * z
        if rw < 0.0:  # q and -q describe the same orientation.
            rx, ry, rz, rw = -rx, -ry, -rz, -rw

        vector_norm = math.sqrt(rx * rx + ry * ry + rz * rz)
        angle_deg = math.degrees(2.0 * math.atan2(vector_norm, max(0.0, rw)))
        # Ignore numerical noise and impossible single-sample jumps.
        if 0.1 <= angle_deg <= 60.0 and vector_norm > 1e-6:
            for axis, component in enumerate((rx, ry, rz)):
                self.rotation_deg[axis] += angle_deg * abs(component) / vector_norm
        self.previous = current

    def percentages(self, target_deg: float = 180.0) -> tuple[int, int, int]:
        return tuple(
            min(100, round(100.0 * rotation / target_deg))
            for rotation in self.rotation_deg
        )


def quat_to_yaw_deg(x: float, y: float, z: float, w: float) -> float:
    """Cap en degres [0,360). Meme formule que bno08x_bridge.py (coherence
    obligatoire : c'est ce meme calcul que verra le systeme en production)."""
    x, y, z, w = normalize_quaternion(x, y, z, w)
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


def close_i2c(i2c) -> None:
    if i2c is None:
        return
    try:
        i2c.deinit()
    except Exception:
        pass


def wait_for_quaternion(sensor, timeout: float = 4.0) -> None:
    """Require one valid rotation report before presenting the UI."""
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            quaternion = sensor.quaternion
            if quaternion is not None:
                quat_to_yaw_deg(*quaternion)
                return
        except (OSError, KeyError, RuntimeError, ValueError) as exc:
            last_error = exc
        time.sleep(0.1)
    detail = f" ({last_error})" if last_error else ""
    raise RuntimeError(f"aucun quaternion valide apres {timeout:.0f}s{detail}")


def open_sensor(*, enable_magnetometer: bool):
    """Open/configure the sensor, retrying transient Linux I2C/SHTP failures."""
    last_error: Exception | None = None
    for attempt in range(1, SENSOR_OPEN_ATTEMPTS + 1):
        i2c = None
        try:
            i2c = ExtendedI2C(I2C_BUS)
            sensor = CalibrationBNO08X(i2c, address=I2C_ADDRESS)
            sensor.enable_feature(BNO_REPORT_ROTATION_VECTOR, report_interval=100000)
            if enable_magnetometer:
                sensor.enable_feature(BNO_REPORT_MAGNETOMETER, report_interval=500000)
            wait_for_quaternion(sensor)
            if sensor.ignored_packet_count:
                print(
                    f"Connexion IMU etablie ({sensor.ignored_packet_count} paquet(s) "
                    "parasite(s) ignore(s))."
                )
            return sensor, i2c
        except (OSError, KeyError, RuntimeError, ValueError) as exc:
            last_error = exc
            close_i2c(i2c)
            if attempt < SENSOR_OPEN_ATTEMPTS:
                print(
                    f"Initialisation IMU instable, nouvelle tentative "
                    f"({attempt}/{SENSOR_OPEN_ATTEMPTS})..."
                )
                time.sleep(1.0)

    raise RuntimeError(
        f"impossible d'initialiser le BNO08x apres {SENSOR_OPEN_ATTEMPTS} tentatives: "
        f"{type(last_error).__name__}: {last_error}"
    )


def magnetometer_accuracy(sensor) -> int | None:
    """Return the accuracy cached from magnetometer reports.

    adafruit-circuitpython-bno08x 1.3.3 implements ``calibration_status`` by
    issuing a blocking ME command. Repeating that command while rotation
    reports are streaming can desynchronise SHTP over Linux I2C. The driver
    already stores the two accuracy bits from every magnetometer report, so
    use that non-blocking value instead (the production bridge does the same).
    """
    status = getattr(sensor, "_magnetometer_accuracy", None)
    return status if status in (0, 1, 2, 3) else None


def begin_chip_calibration(sensor, attempts: int = 3) -> None:
    """Start ME calibration and require an acknowledgement from the BNO08x."""
    for attempt in range(1, attempts + 1):
        command_started = time.monotonic()
        sensor.begin_calibration()
        acknowledged_at = getattr(sensor, "_me_calibration_started_at", -1.0)
        if acknowledged_at >= command_started:
            print("Calibration interne BNO08x demarree et confirmee.")
            return
        if attempt < attempts:
            print(f"Commande de calibration sans reponse, nouvel essai ({attempt}/{attempts})...")
            time.sleep(0.5)
    raise RuntimeError("le BNO08x n'a pas confirme le demarrage de sa calibration")


def live_calibration_loop(sensor) -> None:
    print(
        "\nTournez lentement la camera autour de chacun des axes X, Y et Z.\n"
        "Les pourcentages confirment en direct les mouvements recus ; ils ne\n"
        "sont pas le niveau de calibration. Visez au moins 100% sur chaque axe.\n"
        "Un niveau CALIB stable a 2 ou 3 est suffisant.\n"
        "Appuyez sur Entree quand c'est fait.\n"
    )
    coverage = MotionCoverage()
    magnetic_strength: float | None = None
    while True:
        ready, _, _ = select.select([sys.stdin], [], [], 0.1)
        if ready:
            sys.stdin.readline()
            print()
            return
        try:
            x, y, z, w = sensor.quaternion
            coverage.update((x, y, z, w))
            yaw = quat_to_yaw_deg(x, y, z, w)
            try:
                magnetic = sensor.magnetic
                if magnetic is not None:
                    magnetic_strength = math.sqrt(sum(value * value for value in magnetic))
            except (OSError, KeyError, RuntimeError, ValueError):
                pass
            status = magnetometer_accuracy(sensor)
            status_text = "--" if status is None else str(status)
            x_pct, y_pct, z_pct = coverage.percentages()
            field_text = "--"
            field_quality = ""
            if magnetic_strength is not None:
                field_text = f"{magnetic_strength:.0f}uT"
                field_quality = " OK" if 20.0 <= magnetic_strength <= 80.0 else " PERTURBE"
            hint = ""
            if status == 0 and min(x_pct, y_pct, z_pct) == 100:
                hint = " | mouvements OK: eloigner du metal"
            print(
                f"\rCALIB {status_text}/3 | mouvements X:{x_pct:3d}% Y:{y_pct:3d}% "
                f"Z:{z_pct:3d}% | cap:{yaw:6.1f} | champ:{field_text}{field_quality}"
                f"{hint}   ",
                end="",
                flush=True,
            )
        except Exception:
            print("\rCALIB_STAT: --/3   (lecture capteur en cours...)          ", end="", flush=True)


def measure_heading(
    sensor, samples: int = 20, interval: float = 0.05, timeout: float = 5.0
) -> float:
    """Cap moyen sur ~1s (moyenne circulaire) pour reduire le bruit capteur."""
    sin_sum = 0.0
    cos_sum = 0.0
    got = 0
    deadline = time.monotonic() + timeout
    while got < samples and time.monotonic() < deadline:
        try:
            x, y, z, w = sensor.quaternion
            yaw = quat_to_yaw_deg(x, y, z, w)
        except (OSError, KeyError, RuntimeError, ValueError):
            time.sleep(interval)
            continue
        sin_sum += math.sin(math.radians(yaw))
        cos_sum += math.cos(math.radians(yaw))
        got += 1
        time.sleep(interval)
    if got < samples:
        raise RuntimeError(
            f"Seulement {got}/{samples} lectures de cap valides en {timeout:.0f}s."
        )
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
    time.sleep(1.0)

    known_bearing: float | None = None
    i2c = None
    try:
        sensor, i2c = open_sensor(enable_magnetometer=not args.skip_chip_calibration)

        if not args.skip_chip_calibration:
            begin_chip_calibration(sensor)
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
        print(
            f"\nErreur pendant la calibration : {type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
        return 1
    finally:
        close_i2c(i2c)
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
