"""Export / QA du prototype, Python 3 + numpy + trimesh + OpenSCAD.

Usage : python mounts/export_modular_rig_v04.py [--openscad CHEMIN] [--images-only]
STL : une piece par fichier, dans l'orientation prevue pour le trancheur.
Ne pas confondre cette verification geometrique avec un essai mecanique.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
from pathlib import Path
import shutil
import subprocess

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "modular_camera_rig_v04.scad"
OUT = ROOT / "modular_rig_v04"
PARTS = {
    "rail": (4, 4), "camera_rail": (2, 2), "camera_rail_end": (1, 1),
    "cradle_key": (2, 3),
}


def run(scad: str, name: str, extension: str, defs: dict, extra=()):
    path = OUT / f"{name}.{extension}"
    args = [scad, "--hardwarnings", "-o", str(path)]
    if extension == "stl":
        args += ["--export-format", "binstl"]
    for key, value in defs.items():
        args += ["-D", f"{key}={json.dumps(value)}"]
    result = subprocess.run(args + list(extra) + [str(SOURCE)],
                            capture_output=True, text=True, encoding="utf-8", errors="replace")
    (OUT / f"{name}.log").write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode or "ERROR:" in result.stderr or not path.exists():
        raise RuntimeError(f"Export {name}: {result.stderr}")
    return path


def inspect(path: Path):
    mesh = trimesh.load_mesh(path, process=True)
    components = mesh.split(only_watertight=False)
    size = mesh.extents
    checks = {
        "closed": bool(mesh.is_watertight),
        "consistent_winding": bool(mesh.is_winding_consistent),
        "positive_volume": bool(mesh.volume > 0),
        "one_component": len(components) == 1,
        "fits_170mm": bool(np.all(size <= 170.001)),
        "on_build_plate": abs(float(mesh.bounds[0, 2])) < 0.001,
    }
    record = {"file": path.name, "dimensions_mm": size.round(3).tolist(),
              "volume_cm3": round(float(mesh.volume) / 1000, 3),
              "triangles": len(mesh.faces), "checks": checks}
    if not all(checks.values()):
        raise RuntimeError(f"QA failed: {record}")
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--openscad", default=shutil.which("openscad") or
                        "C:/Program Files/OpenSCAD/openscad.com")
    parser.add_argument("--images-only", action="store_true")
    parser.add_argument("--width", type=float, default=1000)
    parser.add_argument("--fit", type=float, default=0.10)
    args = parser.parse_args()
    OUT.mkdir(exist_ok=True)
    common = {"rig_width": args.width, "fit": args.fit}
    if not args.images_only:
        jobs = [(p, {"view": "part", "part": p}) for p in PARTS]
        jobs.append(("coupon_tongue", {"view": "part", "part": "coupon_tongue"}))
        for gap in (0.05, 0.10, 0.15):
            jobs.append((f"coupon_socket_{round(gap*100):02d}",
                         {"view": "part", "part": "coupon_socket", "coupon_fit": gap}))
        records = []
        # Deux processus independants limitent la memoire de CGAL.
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = {pool.submit(run, args.openscad, name, "stl", {**common, **defs}): name
                       for name, defs in jobs}
            for future in concurrent.futures.as_completed(futures):
                path = future.result()
                record = inspect(path)
                if futures[future] in PARTS:
                    two, three = PARTS[futures[future]]
                    record.update(quantity_2_cameras=two, quantity_3_cameras=three)
                records.append(record)
                print(f"OK {path.name}: {record['dimensions_mm']}", flush=True)
        report = {
            "prototype": "0.4", "rig_width_mm": args.width, "rise_mm": 0,
            "camera_board_z_mm": 133,
            "fit_per_face_mm": args.fit,
            "notice": "CAD only. Fit, stiffness and repeatability require printed tests.",
            "parts": sorted(records, key=lambda r: r["file"]),
        }
        (OUT / "verification.json").write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")

    images = [
        ("camera_rail_bare", {"view": "part", "part": "camera_rail"}, "220,-240,190,70,0,10"),
        ("assembly_3", {"view": "assembly", "camera_count": 3}, "1100,-1500,850,0,0,130"),
        ("assembly_2", {"view": "assembly", "camera_count": 2}, "1100,-1500,850,0,0,130"),
        ("exploded", {"view": "exploded", "camera_count": 3}, "1100,-1500,850,0,0,130"),
        ("cradle_detail", {"view": "cradle_detail", "show_axes": False}, "200,-230,180,0,0,60"),
    ]
    for name, defs, camera in images:
        run(args.openscad, name, "png", {**common, **defs},
            ["--imgsize", "1600,1000", "--camera", camera,
             "--autocenter", "--viewall", "--projection", "o", "--colorscheme", "Tomorrow"])
        print(f"OK {name}.png", flush=True)


if __name__ == "__main__":
    main()
