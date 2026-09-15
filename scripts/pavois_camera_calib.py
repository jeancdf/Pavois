#!/usr/bin/env python3
"""Guided ChArUco calibration for one PAVOIS camera.

The tool measures intrinsics in the exact 1280x720 / 1920x1080 sensor mode
used by pavois_detect, then measures a fixed rail pose from a board whose
centre has a known position in the rail coordinate system.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from typing import Iterable

try:
    import cv2
    import numpy as np
except ImportError as exc:  # pragma: no cover - field dependency check
    raise SystemExit(
        "OpenCV manque. Installez-le avec: sudo apt install python3-opencv"
    ) from exc


SQUARES_X = 7
SQUARES_Y = 5
SQUARE_LENGTH_M = 0.035
MARKER_LENGTH_M = 0.026
DICTIONARY_ID = cv2.aruco.DICT_5X5_100
DEFAULT_CONFIG = Path("/etc/pavois/pavois.conf")
DEFAULT_OUTPUT_DIR = Path("/var/lib/pavois")


def make_board():
    dictionary = cv2.aruco.getPredefinedDictionary(DICTIONARY_ID)
    if hasattr(cv2.aruco, "CharucoBoard"):
        return cv2.aruco.CharucoBoard(
            (SQUARES_X, SQUARES_Y),
            SQUARE_LENGTH_M,
            MARKER_LENGTH_M,
            dictionary,
        )
    return cv2.aruco.CharucoBoard_create(
        SQUARES_X,
        SQUARES_Y,
        SQUARE_LENGTH_M,
        MARKER_LENGTH_M,
        dictionary,
    )


def draw_board(output: Path, width_px: int) -> None:
    board = make_board()
    height_px = round(width_px * (SQUARES_Y / SQUARES_X))
    if hasattr(board, "generateImage"):
        image = board.generateImage((width_px, height_px), marginSize=0, borderBits=1)
    else:
        image = board.draw((width_px, height_px), marginSize=0, borderBits=1)
    output.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(output), image):
        raise RuntimeError(f"impossible d'écrire {output}")
    print(f"Mire écrite : {output}")
    print("Imprimez-la à 245 x 175 mm, sans adaptation à la page.")


class Detector:
    def __init__(self, board):
        self.board = board
        self.dictionary = cv2.aruco.getPredefinedDictionary(DICTIONARY_ID)
        self.detector = None
        if hasattr(cv2.aruco, "CharucoDetector"):
            params = cv2.aruco.DetectorParameters()
            params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
            self.detector = cv2.aruco.CharucoDetector(
                board, cv2.aruco.CharucoParameters(), params
            )

    def detect(self, gray):
        if self.detector is not None:
            corners, ids, _marker_corners, _marker_ids = self.detector.detectBoard(gray)
            return corners, ids
        marker_corners, marker_ids, _ = cv2.aruco.detectMarkers(
            gray, self.dictionary
        )
        if marker_ids is None or len(marker_ids) == 0:
            return None, None
        count, corners, ids = cv2.aruco.interpolateCornersCharuco(
            marker_corners, marker_ids, gray, self.board
        )
        return (corners, ids) if count else (None, None)


def read_config(path: Path) -> tuple[list[str], dict[str, str]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    values: dict[str, str] = {}
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith(("#", ";")) or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip()
    return lines, values


def camera_index(values: dict[str, str]) -> int:
    indices = sorted(
        int(match.group(1))
        for key in values
        if (match := re.fullmatch(r"camera\.(\d+)\.id", key))
    )
    if not indices:
        raise RuntimeError("aucune camera.N.id dans la configuration")
    return indices[0]


def config_number(values: dict[str, str], key: str, default: float) -> float:
    try:
        return float(values.get(key, str(default)))
    except ValueError:
        return default


def write_config(path: Path, updates: dict[str, float | bool]) -> Path:
    lines, _ = read_config(path)
    remaining = dict(updates)
    output: list[str] = []
    for line in lines:
        stripped = line.strip()
        if "=" not in stripped or stripped.startswith(("#", ";")):
            output.append(line)
            continue
        key = stripped.split("=", 1)[0].strip()
        if key not in remaining:
            output.append(line)
            continue
        value = remaining.pop(key)
        output.append(f"{key}={format_config_value(value)}")
    if remaining:
        output.append("")
        output.append("# Calibration ChArUco automatique")
        for key, value in remaining.items():
            output.append(f"{key}={format_config_value(value)}")

    stamp = int(time.time())
    backup = path.with_name(f"{path.name}.before-camera-calib-{stamp}")
    shutil.copy2(path, backup)
    old_stat = path.stat()
    temp = path.with_name(f".{path.name}.camera-calib-{os.getpid()}")
    temp.write_text("\n".join(output) + "\n", encoding="utf-8")
    os.chmod(temp, old_stat.st_mode)
    os.chown(temp, old_stat.st_uid, old_stat.st_gid)
    os.replace(temp, path)
    return backup


def format_config_value(value: float | bool) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return f"{value:.10g}"


class CameraSession:
    def __init__(self, config_path: Path):
        self.config_path = config_path
        self.was_active = False
        self.camera = None

    def __enter__(self):
        self.was_active = (
            subprocess.run(
                ["systemctl", "is-active", "--quiet", "pavois.service"],
                check=False,
            ).returncode
            == 0
        )
        if self.was_active:
            print("Arrêt temporaire de pavois.service pour libérer la caméra...")
            subprocess.run(["systemctl", "stop", "pavois.service"], check=True)
        try:
            from picamera2 import Picamera2
        except ImportError as exc:
            raise RuntimeError(
                "Picamera2 manque. Installez python3-picamera2."
            ) from exc

        _, values = read_config(self.config_path)
        index = camera_index(values)
        prefix = f"camera.{index}."
        width = int(config_number(values, prefix + "width", 1280))
        height = int(config_number(values, prefix + "height", 720))
        fps = int(config_number(values, prefix + "fps", 0))
        limit_fps = values.get(prefix + "limit_fps", "false").lower() in ("true", "1")
        if (width, height) != (1280, 720):
            raise RuntimeError(
                f"la calibration terrain attend le mode déployé 1280x720, pas {width}x{height}"
            )

        self.camera = Picamera2(index)
        # Match the detector's maximum-rate request without dividing by zero.
        if fps < 0:
            raise RuntimeError("camera fps doit être positif ou 0 (maximum)")
        requested_fps = fps if limit_fps and fps > 0 else 1000
        frame_us = max(1, round(1_000_000 / requested_fps))
        controls = {"FrameDurationLimits": (frame_us, frame_us)}
        configuration = self.camera.create_video_configuration(
            main={"size": (width, height), "format": "RGB888"},
            sensor={"output_size": (1920, 1080), "bit_depth": 10},
            controls=controls,
            buffer_count=4,
        )
        self.camera.configure(configuration)
        self.camera.start()
        time.sleep(1.0)
        return self.camera, index, values

    def __exit__(self, exc_type, exc, tb):
        if self.camera is not None:
            self.camera.stop()
            self.camera.close()
        if self.was_active:
            print("Redémarrage de pavois.service...")
            subprocess.run(["systemctl", "start", "pavois.service"], check=False)


def feature_of(corners, width: int, height: int) -> np.ndarray:
    points = corners.reshape(-1, 2).astype(np.float32)
    centre = points.mean(axis=0)
    rect = cv2.minAreaRect(points)
    size = max(rect[1][0] * rect[1][1], 1.0)
    angle = math.radians(rect[2])
    return np.array(
        [
            centre[0] / width,
            centre[1] / height,
            math.sqrt(size / (width * height)),
            0.18 * math.sin(2 * angle),
            0.18 * math.cos(2 * angle),
        ],
        dtype=np.float64,
    )


def board_points(board, ids) -> np.ndarray:
    chess = np.asarray(board.getChessboardCorners(), dtype=np.float32)
    return chess[np.asarray(ids).reshape(-1)].reshape(-1, 1, 3)


def reprojection_error(obj, img, rvec, tvec, matrix, distortion) -> float:
    projected, _ = cv2.projectPoints(obj, rvec, tvec, matrix, distortion)
    return float(cv2.norm(img, projected, cv2.NORM_L2) / math.sqrt(len(projected)))


def capture_intrinsics(args) -> None:
    board = make_board()
    detector = Detector(board)
    object_sets: list[np.ndarray] = []
    image_sets: list[np.ndarray] = []
    features: list[np.ndarray] = []
    started = time.monotonic()
    last_accept = 0.0

    with CameraSession(args.config) as (camera, index, values):
        prefix = f"camera.{index}."
        camera_id = values[prefix + "id"]
        print(
            "Bougez lentement la mire : centre, bords, coins et inclinaisons. "
            "Les vues trop proches sont refusées automatiquement. Ctrl+C pour arrêter."
        )
        try:
            while len(image_sets) < args.views and time.monotonic() - started < args.timeout:
                frame = camera.capture_array("main")
                gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
                corners, ids = detector.detect(gray)
                count = 0 if ids is None else len(ids)
                now = time.monotonic()
                accepted = False
                if count >= args.min_corners and now - last_accept >= 0.45:
                    feature = feature_of(corners, gray.shape[1], gray.shape[0])
                    diverse = not features or min(
                        float(np.linalg.norm(feature - previous)) for previous in features
                    ) >= args.diversity
                    if diverse:
                        object_sets.append(board_points(board, ids))
                        image_sets.append(corners.astype(np.float32))
                        features.append(feature)
                        last_accept = now
                        accepted = True
                status = "VUE AJOUTÉE" if accepted else "déplacez/inclinez la mire"
                print(
                    f"\rIntrinsèques {len(image_sets):2d}/{args.views} | "
                    f"coins {count:2d} | {status:<26}",
                    end="",
                    flush=True,
                )
        except KeyboardInterrupt:
            pass
        print()
        if len(image_sets) < args.minimum_views:
            raise RuntimeError(
                f"seulement {len(image_sets)} vues distinctes; minimum {args.minimum_views}"
            )

        image_size = (1280, 720)
        rms, matrix, distortion, rvecs, tvecs = cv2.calibrateCamera(
            object_sets, image_sets, image_size, None, None
        )
        errors = [
            reprojection_error(obj, img, rvec, tvec, matrix, distortion)
            for obj, img, rvec, tvec in zip(object_sets, image_sets, rvecs, tvecs)
        ]
        coeffs = np.zeros(5, dtype=np.float64)
        flat = np.asarray(distortion).reshape(-1)
        coeffs[: min(5, len(flat))] = flat[:5]
        fx, fy = float(matrix[0, 0]), float(matrix[1, 1])
        cx, cy = float(matrix[0, 2]), float(matrix[1, 2])
        hfov = math.degrees(2 * math.atan(image_size[0] / (2 * fx)))
        if rms > args.max_rms and not args.force:
            raise RuntimeError(
                f"RMS {rms:.3f}px trop élevé (limite {args.max_rms:.2f}); recommencez avec une mire plus nette"
            )

        updates = {
            prefix + "fx": fx,
            prefix + "fy": fy,
            prefix + "cx": cx,
            prefix + "cy": cy,
            prefix + "k1": float(coeffs[0]),
            prefix + "k2": float(coeffs[1]),
            prefix + "p1": float(coeffs[2]),
            prefix + "p2": float(coeffs[3]),
            prefix + "k3": float(coeffs[4]),
            prefix + "fov_deg": hfov,
        }
        backup = write_config(args.config, updates)
        result = {
            "cameraId": camera_id,
            "imageSize": list(image_size),
            "sensorMode": "1920x1080 -> 1280x720",
            "board": board_description(),
            "views": len(image_sets),
            "rmsPx": float(rms),
            "meanViewErrorPx": float(np.mean(errors)),
            "cameraMatrix": matrix.tolist(),
            "distortion": coeffs.tolist(),
            "hfovDeg": hfov,
            "configBackup": str(backup),
        }
        output = args.output_dir / f"camera-intrinsics-{camera_id}.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(
            f"Intrinsèques {camera_id}: RMS={rms:.3f}px, fx={fx:.2f}, "
            f"fy={fy:.2f}, HFOV={hfov:.2f}°"
        )
        print(f"Configuration mise à jour; sauvegarde : {backup}")
        print(f"Rapport : {output}")


def board_description() -> dict[str, float | int | str]:
    return {
        "dictionary": "DICT_5X5_100",
        "squaresX": SQUARES_X,
        "squaresY": SQUARES_Y,
        "squareLengthM": SQUARE_LENGTH_M,
        "markerLengthM": MARKER_LENGTH_M,
        "widthM": SQUARES_X * SQUARE_LENGTH_M,
        "heightM": SQUARES_Y * SQUARE_LENGTH_M,
    }


def calibrated_intrinsics(values: dict[str, str], prefix: str):
    names = ("fx", "fy", "cx", "cy", "k1", "k2", "p1", "p2", "k3")
    missing = [name for name in names if prefix + name not in values]
    if missing:
        raise RuntimeError(
            "intrinsèques absentes (" + ", ".join(missing) + "); lancez d'abord 'intrinsics'"
        )
    matrix = np.array(
        [
            [float(values[prefix + "fx"]), 0, float(values[prefix + "cx"])],
            [0, float(values[prefix + "fy"]), float(values[prefix + "cy"])],
            [0, 0, 1],
        ],
        dtype=np.float64,
    )
    distortion = np.array(
        [float(values[prefix + name]) for name in ("k1", "k2", "p1", "p2", "k3")],
        dtype=np.float64,
    )
    return matrix, distortion


def world_from_board(board_centre: Iterable[float]):
    centre = np.asarray(list(board_centre), dtype=np.float64).reshape(3)
    # Board X -> rail +X, board Y (down) -> rail -Z, board normal -> rail +Y.
    rotation = np.array(
        [[1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, -1.0, 0.0]],
        dtype=np.float64,
    )
    board_local_centre = np.array(
        [SQUARES_X * SQUARE_LENGTH_M / 2, SQUARES_Y * SQUARE_LENGTH_M / 2, 0],
        dtype=np.float64,
    )
    translation = centre - rotation @ board_local_centre
    return rotation, translation


def camera_pose_from_pnp(rvec, tvec, board_centre):
    camera_from_board, _ = cv2.Rodrigues(rvec)
    board_from_camera = camera_from_board.T
    camera_in_board = -board_from_camera @ np.asarray(tvec).reshape(3)
    world_from_board_rotation, world_from_board_translation = world_from_board(
        board_centre
    )
    world_from_camera = world_from_board_rotation @ board_from_camera
    position = world_from_board_rotation @ camera_in_board + world_from_board_translation
    return position, world_from_camera


def average_rotation(rotations: list[np.ndarray]) -> np.ndarray:
    u, _singular, vt = np.linalg.svd(np.mean(rotations, axis=0))
    rotation = u @ vt
    if np.linalg.det(rotation) < 0:
        u[:, -1] *= -1
        rotation = u @ vt
    return rotation


def pose_angles(rotation: np.ndarray) -> tuple[float, float, float]:
    right = rotation[:, 0]
    forward = rotation[:, 2]
    heading = math.atan2(float(forward[0]), float(forward[1]))
    elevation = math.atan2(
        float(forward[2]), math.hypot(float(forward[0]), float(forward[1]))
    )
    right_zero = np.array([math.cos(heading), -math.sin(heading), 0.0])
    forward_unit = forward / np.linalg.norm(forward)
    up_zero = np.cross(right_zero, forward_unit)
    up_zero /= np.linalg.norm(up_zero)
    roll = math.atan2(float(np.dot(right, up_zero)), float(np.dot(right, right_zero)))
    return tuple(math.degrees(value) for value in (heading, elevation, roll))


def capture_rig_pose(args) -> None:
    board = make_board()
    detector = Detector(board)
    positions: list[np.ndarray] = []
    rotations: list[np.ndarray] = []
    errors: list[float] = []
    started = time.monotonic()

    with CameraSession(args.config) as (camera, index, values):
        prefix = f"camera.{index}."
        camera_id = values[prefix + "id"]
        matrix, distortion = calibrated_intrinsics(values, prefix)
        print(
            "Gardez la mire IMMOBILE et verticale, face aux caméras. "
            f"Son centre déclaré est {tuple(args.board_center)} m."
        )
        while len(positions) < args.samples and time.monotonic() - started < args.timeout:
            frame = camera.capture_array("main")
            gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
            corners, ids = detector.detect(gray)
            count = 0 if ids is None else len(ids)
            error = None
            if count >= args.min_corners:
                obj = board_points(board, ids)
                ok, rvec, tvec = cv2.solvePnP(
                    obj, corners, matrix, distortion, flags=cv2.SOLVEPNP_ITERATIVE
                )
                if ok:
                    error = reprojection_error(
                        obj, corners, rvec, tvec, matrix, distortion
                    )
                    if error <= args.max_frame_error:
                        position, rotation = camera_pose_from_pnp(
                            rvec, tvec, args.board_center
                        )
                        positions.append(position)
                        rotations.append(rotation)
                        errors.append(error)
            quality = "—" if error is None else f"{error:.2f}px"
            print(
                f"\rPose rail {len(positions):2d}/{args.samples} | "
                f"coins {count:2d} | reprojection {quality:<8}",
                end="",
                flush=True,
            )
        print()
        if len(positions) < max(8, args.samples // 2):
            raise RuntimeError("pas assez de mesures stables de la mire")

        pos_array = np.asarray(positions)
        median = np.median(pos_array, axis=0)
        distances = np.linalg.norm(pos_array - median, axis=1)
        mad = float(np.median(np.abs(distances - np.median(distances))))
        limit = max(0.02, float(np.median(distances)) + 3.0 * max(mad, 0.002))
        inliers = [i for i, distance in enumerate(distances) if distance <= limit]
        position = np.mean(pos_array[inliers], axis=0)
        rotation = average_rotation([rotations[i] for i in inliers])
        heading, elevation, roll = pose_angles(rotation)
        spread = float(np.sqrt(np.mean(np.sum((pos_array[inliers] - position) ** 2, axis=1))))
        if spread > args.max_spread and not args.force:
            raise RuntimeError(
                f"pose instable ({spread * 100:.1f} cm RMS); fixez la mire et recommencez"
            )

        updates = {
            prefix + "rail_pose_enabled": True,
            prefix + "rail_x": float(position[0]),
            prefix + "rail_y": float(position[1]),
            prefix + "rail_z": float(position[2]),
            prefix + "rail_heading_deg": heading % 360.0,
            prefix + "rail_elevation_deg": elevation,
            prefix + "rail_roll_deg": roll,
        }
        backup = write_config(args.config, updates)
        result = {
            "cameraId": camera_id,
            "board": board_description(),
            "boardCenterRailM": list(args.board_center),
            "samples": len(positions),
            "inliers": len(inliers),
            "meanReprojectionErrorPx": float(np.mean([errors[i] for i in inliers])),
            "positionSpreadM": spread,
            "railPose": {
                "x": float(position[0]),
                "y": float(position[1]),
                "z": float(position[2]),
                "headingDeg": heading % 360.0,
                "elevationDeg": elevation,
                "rollDeg": roll,
            },
            "configBackup": str(backup),
        }
        output = args.output_dir / f"camera-rail-pose-{camera_id}.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(
            f"Pose {camera_id}: xyz=({position[0]:.3f}, {position[1]:.3f}, "
            f"{position[2]:.3f}) m, cap={heading % 360:.2f}°, "
            f"élévation={elevation:.2f}°, roll={roll:.2f}°"
        )
        print(f"Stabilité={spread * 100:.1f} cm RMS; rapport : {output}")
        print(f"Configuration mise à jour; sauvegarde : {backup}")


def add_common_capture(parser) -> None:
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument("--min-corners", type=int, default=10)
    parser.add_argument("--force", action="store_true")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    board = commands.add_parser("board", help="générer la mire imprimable")
    board.add_argument("--output", type=Path, default=Path("charuco-board-a4.png"))
    board.add_argument("--width-px", type=int, default=2894)

    intrinsics = commands.add_parser(
        "intrinsics", help="mesurer focale, centre optique et distorsion"
    )
    add_common_capture(intrinsics)
    intrinsics.add_argument("--views", type=int, default=24)
    intrinsics.add_argument("--minimum-views", type=int, default=14)
    intrinsics.add_argument("--diversity", type=float, default=0.075)
    intrinsics.add_argument("--max-rms", type=float, default=1.0)

    rig = commands.add_parser("rig", help="mesurer la pose fixe sur le rail")
    add_common_capture(rig)
    rig.add_argument("--samples", type=int, default=30)
    rig.add_argument("--max-frame-error", type=float, default=1.5)
    rig.add_argument("--max-spread", type=float, default=0.03)
    rig.add_argument(
        "--board-center",
        type=float,
        nargs=3,
        metavar=("X", "Y", "Z"),
        default=(0.0, 2.5, 0.4),
        help="centre mesuré de la mire dans le repère rail, en mètres",
    )
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "board":
            draw_board(args.output, args.width_px)
        elif args.command == "intrinsics":
            capture_intrinsics(args)
        else:
            capture_rig_pose(args)
        return 0
    except Exception as exc:
        print(f"\nErreur calibration caméra : {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
