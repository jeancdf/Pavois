"""Intersections volumiques des assemblages nominaux, via OpenSCAD/CGAL.

Les contacts de surface sont autorises. Aucun calcul de resistance ou de nappe.
Les wrappers sont temporaires ; le resultat est livre avec les STL.
"""
from pathlib import Path
import json
import subprocess
import tempfile

import numpy as np

import trimesh

ROOT = Path(__file__).resolve().parent
SCAD = "C:/Program Files/OpenSCAD/openscad.com"
SOURCE = (ROOT / "modular_camera_rig_v03.scad").as_posix()
V2 = (ROOT / "modular_rig_v02" / "rail.stl").as_posix()
MOUNT = (ROOT / "camera_mount_v2_pi25.scad").as_posix()
PITCH = 1000/7
CASES = {
    "berceau_support_v2": ["cradle();", "translate([0,0,6]) mount();"],
    "cale_support_v2": ["translate([0,-32,0]) cradle_key();", "translate([0,0,6]) mount();"],
    "cale_berceau": ["translate([0,-32,0]) cradle_key();", "cradle();"],
    "rail_rail": ["rail();", "translate([1000/7,0,0]) rail();"],
    "rail_berceau_integre": ["rail();", "translate([1000/7,0,0]) camera_rail();"],
    "berceau_integre_rail": ["camera_rail();", "translate([1000/7,0,0]) rail();"],
    "berceau_berceau_terminal": ["camera_rail();", "translate([1000/7,0,0]) camera_rail(true);"],
    "descente_rail_au_dessus": ["translate([0,0,9]) rail();", "translate([1000/7,0,0]) camera_rail();"],
    "descente_rail_mi_course": ["translate([0,0,4]) rail();", "translate([1000/7,0,0]) camera_rail();"],
    "descente_berceau_mi_course": ["translate([0,0,4]) camera_rail();", "translate([1000/7,0,0]) rail();"],
    "v3_male_v2_female": ["rail();", 'translate([1000/7,0,0]) v2_rail();'],
    "v2_male_v3_female": ['v2_rail();', "translate([1000/7,0,0]) rail();"],
    "coupon": ["coupon_tongue();", "coupon_socket();"],
}


def main():
    results = []
    with tempfile.TemporaryDirectory(prefix="pavois-cad-") as tmp:
        temp = Path(tmp)
        for name, pair in CASES.items():
            source, output = temp / f"{name}.scad", temp / f"{name}.stl"
            source.write_text(f'use <{SOURCE}>\nuse <{MOUNT}>\nmodule v2_rail() {{ import("{V2}"); }}\nintersection() {{\n'+"\n".join(pair)+"\n}\n", encoding="utf-8")
            proc = subprocess.run([SCAD, "-o", str(output), str(source)],
                                  capture_output=True, text=True, encoding="utf-8", errors="replace")
            log = proc.stdout + proc.stderr
            if "ERROR:" in log or any("WARNING:" in line and "2-manifold" not in line
                                       for line in log.splitlines()):
                raise RuntimeError(log)
            if output.exists():
                with np.errstate(invalid="ignore", divide="ignore"):
                    volume = abs(float(trimesh.load_mesh(output).volume))
            elif "Current top level object is empty" in log:
                volume = 0
            else:
                raise RuntimeError(f"Exit {proc.returncode}: {log!r}; source={source.read_text()}")
            record = {"pair": name, "intersection_mm3": round(volume, 6), "pass": volume < 0.01,
                      "surface_contact_only": "2-manifold" in log and volume < 0.01}
            results.append(record)
            print(record, flush=True)
    report = {"scope": "Named mating pairs at default dimensions; not a structural or cable test.", "pairs": results}
    (ROOT / "modular_rig_v03" / "assembly_checks.json").write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
    if not all(r["pass"] for r in results):
        raise SystemExit("Interferences a corriger")


if __name__ == "__main__":
    main()
