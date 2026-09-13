"""Compare CAD variants using the same local Bambu Studio slice settings.

No printing or printer connection. Each model gets an isolated output folder.
"""
from pathlib import Path
import argparse
import json
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent
PROFILES = Path('C:/Program Files/Bambu Studio/resources/profiles/BBL')
EXE = 'C:/Program Files/Bambu Studio/bambu-studio.exe'


def profile(kind, name, stack=()):
    if name in stack:
        raise ValueError('Profile inheritance cycle')
    raw = json.loads((PROFILES/kind/(name+'.json')).read_text(encoding='utf-8-sig'))
    result = profile(kind, raw['inherits'], stack+(name,)) if raw.get('inherits') else {}
    includes = raw.get('include', [])
    if isinstance(includes, str):
        includes = [includes]
    for part in includes:
        result.update(profile(kind, part, stack+(name,)))
    result.update(raw)
    result.pop('inherits', None)
    result.pop('include', None)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('models', nargs='+', help='label=absolute-or-relative-STL')
    parser.add_argument('--walls', type=int, default=5)
    parser.add_argument('--infill', type=int, default=20)
    parser.add_argument('--output', type=Path, default=ROOT/'rig_benchmark')
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    presets = {
        'machine': profile('machine', 'Bambu Lab A1 mini 0.4 nozzle'),
        'process': profile('process', '0.20mm Standard @BBL A1M'),
        'filament': profile('filament', 'Generic PLA @BBL A1M'),
    }
    presets['process'].update(wall_loops=str(args.walls), sparse_infill_density=f'{args.infill}%',
                              enable_support='1', support_type='normal(auto)',
                              support_on_build_plate_only='1', brim_type='no_brim')
    for kind, value in presets.items():
        (out/(kind+'.json')).write_text(json.dumps(value, indent=2), encoding='utf-8')
    for model in args.models:
        label, path = model.split('=', 1)
        if not label.replace('_', '').isalnum():
            raise ValueError('Use a simple alphanumeric model label')
        path = Path(path).resolve()
        folder = out/label
        folder.mkdir(exist_ok=True)
        cmd = [EXE, '--arrange', '1', '--curr-bed-type', 'Textured PEI Plate',
               '--load-settings', f'{out / "machine.json"};{out / "process.json"}',
               '--load-filaments', str(out/'filament.json'), '--slice', '0',
               '--debug', '2', '--outputdir', str(folder),
               '--export-3mf', 'sliced.3mf', str(path)]
        (folder/'command.json').write_text(json.dumps(cmd, indent=2), encoding='utf-8')
        print('Slicing '+label, flush=True)
        run = subprocess.run(cmd, cwd=folder, capture_output=True, text=True,
                             encoding='utf-8', errors='replace', creationflags=0x08000000,
                             timeout=300)
        (folder/'console.log').write_text(run.stdout+run.stderr, encoding='utf-8')
        result = json.loads((folder/'result.json').read_text()) if (folder/'result.json').exists() else {}
        print(json.dumps({'model': label, 'exit': run.returncode, 'result': result}), flush=True)
        if run.returncode or result.get('return_code', 0) or not (folder/'sliced.3mf').exists():
            raise RuntimeError(f'{label}: slicing failed, see {folder}')
        with zipfile.ZipFile(folder/'sliced.3mf') as archive:
            print(archive.namelist(), flush=True)


if __name__ == '__main__':
    main()
