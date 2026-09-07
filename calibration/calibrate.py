"""Calibration OV5647 pour Pavois.

Usage:  py -3 calibrate.py <dossier_images> [taille_case_mm]

Damier attendu : 10x7 cases (9x6 coins internes), cases de 25 mm.
Sortie : camera_calibration.json (matrice K, distorsion, FOV) + resume console.
NB: la taille de case n'influence que l'echelle metrique, pas fx/fy ni la distorsion.
"""
import sys
import json
import math
from pathlib import Path

import cv2
import numpy as np

PATTERN = (9, 6)  # coins internes (colonnes, lignes)


def main():
    img_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "images")
    square_mm = float(sys.argv[2]) if len(sys.argv) > 2 else 25.0

    files = sorted(
        p for p in img_dir.iterdir()
        if p.suffix.lower() in (".jpg", ".jpeg", ".png")
    )
    if not files:
        sys.exit(f"Aucune image dans {img_dir}")

    objp = np.zeros((PATTERN[0] * PATTERN[1], 3), np.float32)
    objp[:, :2] = np.mgrid[0:PATTERN[0], 0:PATTERN[1]].T.reshape(-1, 2)
    objp *= square_mm / 1000.0  # en metres

    obj_points, img_points, used = [], [], []
    size = None
    for f in files:
        img = cv2.imread(str(f))
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        if size is None:
            size = gray.shape[::-1]
        elif gray.shape[::-1] != size:
            print(f"  {f.name}: resolution differente, ignoree")
            continue
        ok, corners = cv2.findChessboardCornersSB(
            gray, PATTERN, flags=cv2.CALIB_CB_EXHAUSTIVE | cv2.CALIB_CB_ACCURACY
        )
        if not ok:
            ok, corners = cv2.findChessboardCorners(gray, PATTERN)
            if ok:
                corners = cv2.cornerSubPix(
                    gray, corners, (11, 11), (-1, -1),
                    (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001),
                )
        print(f"  {f.name}: {'OK' if ok else 'damier non detecte'}")
        if ok:
            obj_points.append(objp)
            img_points.append(corners)
            used.append(f.name)

    if len(obj_points) < 8:
        sys.exit(f"Seulement {len(obj_points)} vues valides — il en faut >= 8 (ideal 15+). Refaire une capture.")

    rms, K, dist, rvecs, tvecs = cv2.calibrateCamera(obj_points, img_points, size, None, None)

    per_image = []
    for i in range(len(obj_points)):
        proj, _ = cv2.projectPoints(obj_points[i], rvecs[i], tvecs[i], K, dist)
        err = cv2.norm(img_points[i], proj, cv2.NORM_L2) / math.sqrt(len(proj))
        per_image.append((used[i], float(err)))

    w, h = size
    fx, fy, cx, cy = K[0, 0], K[1, 1], K[0, 2], K[1, 2]
    hfov = math.degrees(2 * math.atan(w / (2 * fx)))
    vfov = math.degrees(2 * math.atan(h / (2 * fy)))

    result = {
        "image_size": [w, h],
        "sensor_mode": "1296x972 (binning 2x2, plein champ OV5647)",
        "rms_reprojection_error_px": float(rms),
        "camera_matrix": K.tolist(),
        "fx_px": float(fx), "fy_px": float(fy),
        "cx_px": float(cx), "cy_px": float(cy),
        "distortion_coefficients_k1_k2_p1_p2_k3": dist.ravel().tolist(),
        "hfov_deg": hfov, "vfov_deg": vfov,
        "views_used": len(obj_points),
        "per_image_error_px": {n: e for n, e in per_image},
    }
    out = img_dir.parent / "camera_calibration.json"
    out.write_text(json.dumps(result, indent=2))

    print(f"\n=== Resultat ({len(obj_points)} vues) ===")
    print(f"RMS reprojection : {rms:.3f} px  (bon si < 0.5, acceptable < 1.0)")
    print(f"fx = {fx:.1f} px   fy = {fy:.1f} px")
    print(f"centre optique   : ({cx:.1f}, {cy:.1f})  [centre geometrique: ({w/2:.0f}, {h/2:.0f})]")
    print(f"HFOV = {hfov:.2f} deg   VFOV = {vfov:.2f} deg   (fiche OV5647: 53.5 x 41.4)")
    print(f"distorsion k1={dist.ravel()[0]:+.4f} k2={dist.ravel()[1]:+.4f} "
          f"p1={dist.ravel()[2]:+.5f} p2={dist.ravel()[3]:+.5f} k3={dist.ravel()[4]:+.4f}")
    worst = max(per_image, key=lambda x: x[1])
    print(f"pire image       : {worst[0]} ({worst[1]:.3f} px)")
    print(f"\nEcrit -> {out}")
    print(f"Pour Pavois metadata.json : fov_degrees = {hfov:.2f}")


if __name__ == "__main__":
    main()
