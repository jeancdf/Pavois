"""Slice V5 using the standalone user profiles saved beside its STL files.
No printer connection. Automatic supports are enabled in each exported 3MF.
"""
from pathlib import Path
import argparse
import json
import subprocess
import shutil

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'modular_rig_v05'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bambu',default=shutil.which('bambu-studio') or
                        'C:/Program Files/Bambu Studio/bambu-studio.exe')
    args=parser.parse_args()
    presets={kind:json.loads((OUT/('user_'+kind+'.json')).read_text(encoding='utf-8'))
             for kind in ['machine','process','filament']}
    c=presets['process']
    assert c['enable_support']=='1' and c['support_type']=='normal(auto)'
    assert c['support_on_build_plate_only']=='0'
    assert float(c['layer_height'])==0.08, 'Update output names if changing layer height'
    results=[]
    for name in ['camera_rail','camera_end_left','camera_end_right']:
        folder=OUT/('slice_'+name); folder.mkdir(exist_ok=True)
        command=[args.bambu,'--arrange','1','--curr-bed-type','Textured PEI Plate',
                 '--load-settings',str(OUT/'user_machine.json')+';'+str(OUT/'user_process.json'),
                 '--load-filaments',str(OUT/'user_filament.json'),'--slice','0','--debug','2',
                 '--outputdir',str(folder),'--export-3mf','sliced.3mf',str(OUT/(name+'.stl'))]
        run=subprocess.run(command,cwd=folder,capture_output=True,text=True,
                           encoding='utf-8',errors='replace',
                           creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),timeout=300)
        (folder/'console.log').write_text(run.stdout+run.stderr,encoding='utf-8')
        r=json.loads((folder/'result.json').read_text())
        if run.returncode or r['return_code']: raise RuntimeError(r)
        plate=r['sliced_plates'][0]
        record={'part':name,'seconds':round(plate['total_predication']),
                'filament_g':round(plate['filaments'][0]['total_used_g'],2),
                'warning':plate.get('warning_message','')}
        results.append(record); print(record,flush=True)
        (OUT/(name+'_0p08mm.3mf')).write_bytes((folder/'sliced.3mf').read_bytes())
    report={'settings_source':'user_machine.json, user_process.json, user_filament.json',
            'layer_height_mm':float(c['layer_height']),
            'wall_loops':int(c['wall_loops']),'infill':c['sparse_infill_density'],
            'automatic_supports':True,'built_in_supports':False,
            'not_validated':'Physical breakaway force and printed fit','results':results}
    (OUT/'slicing_report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__': main()
