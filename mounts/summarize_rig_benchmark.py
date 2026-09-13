"""Publish measured slicer estimates, motion counts and the exact settings.

Run benchmark_rig.py for labels v2, v3, v4_final before running this script.
"""
from pathlib import Path
import hashlib
import json
import re
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent
BENCH = ROOT/'rig_benchmark'
OUT = ROOT/'modular_rig_v04'


def main():
    rows = []
    protocol = None
    for version, label, folder in [('V2', 'v2', 'modular_rig_v02'),
                                    ('V3', 'v3', 'modular_rig_v03'),
                                    ('V4', 'v4_final', 'modular_rig_v04')]:
        result_path = BENCH/label/'result.json'
        result = json.loads(result_path.read_text())
        assert result['return_code'] == 0
        actual = (round(result['layer_height'], 4), result['wall_loops'], result['sparse_infill_density'])
        if protocol is None:
            protocol = actual
        if actual != protocol:
            raise ValueError('Different slicing protocols: re-slice all variants with identical settings')
        plate = result['sliced_plates'][0]
        with zipfile.ZipFile(BENCH/label/'sliced.3mf') as z:
            gcode = z.read('Metadata/plate_1.gcode').decode()
        lines = gcode.splitlines()
        secs = round(plate['total_predication'])
        motion = sum(bool(re.match(r'^G[0123]\s', line)) and
                     bool(re.search(r'\b[XY][-+\d.]', line)) for line in lines)
        stl = ROOT/folder/'camera_rail.stl'
        rows.append({'version': version, 'total_estimated_seconds': secs,
                     'estimated_duration': f'{secs//3600}h {(secs%3600)//60:02d}m {secs%60:02d}s',
                     'layers': sum(line.startswith('; CHANGE_LAYER') for line in lines),
                     'xy_motion_commands': motion,
                     'filament_g': round(plate['filaments'][0]['total_used_g'], 2),
                     'wall_time_seconds': round(sum(plate['feature_type_times'].get(k, 0)
                                                   for k in ['Inner wall', 'Outer wall'])),
                     'stl_sha256': hashlib.sha256(stl.read_bytes()).hexdigest(),
                     'slicer': re.search(r'^; BambuStudio (.+)$', gcode, re.M).group(1)})
        shutil.copy2(result_path, OUT/(version.lower()+'_slice_result.json'))
    report = {'method': 'Same Bambu Studio profiles and base-down orientation for all three models',
              'machine': 'Bambu Lab A1 mini 0.4 nozzle', 'filament': 'Generic PLA',
              'layer_height_mm': protocol[0], 'wall_loops': protocol[1], 'infill_percent': protocol[2],
              'support': 'normal(auto), build plate only', 'brim': 'none',
              'scope': 'Slicer estimates, not measured physical print durations. User presets may differ.',
              'xy_definition': 'Count of G0/G1/G2/G3 lines containing X or Y, including startup moves',
              'results': rows,
              'v4_time_reduction_vs_v2_percent': round(100*(1-rows[2]['total_estimated_seconds']/rows[0]['total_estimated_seconds']), 1),
              'v4_xy_reduction_vs_v3_percent': round(100*(1-rows[2]['xy_motion_commands']/rows[1]['xy_motion_commands']), 1)}
    (OUT/'slicing_comparison.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    for kind in ['machine', 'process', 'filament']:
        shutil.copy2(BENCH/(kind+'.json'), OUT/('benchmark_'+kind+'.json'))
    shutil.copy2(BENCH/'v4_final'/'sliced.3mf', OUT/'camera_rail_sliced_A1mini.3mf')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
