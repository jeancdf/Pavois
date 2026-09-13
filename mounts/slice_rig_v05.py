"""Slice V5 with settings read from the user's existing camera_rail_end.3mf.
No printer connection; original project is read only. Automatic supports enabled in exported 3MF.
"""
from pathlib import Path
import json
import subprocess
import zipfile
from benchmark_rig import profile, EXE

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'modular_rig_v05'


def main():
    project=ROOT/'camera_rail_end.3mf'
    with zipfile.ZipFile(project) as z:
        c=json.loads(z.read('Metadata/project_settings.config'))
    presets={
        'machine':profile('machine',c['printer_settings_id']),
        'process':profile('process',c['print_settings_id']),
        'filament':profile('filament',c['filament_settings_id'][0]),
    }
    metadata={'name','type','from','setting_id','instantiation','version'}
    for kind,p in presets.items():
        for k in list(p):
            if k in c and k not in metadata: p[k]=c[k]
        if kind=='process': p['enable_support']='1'; p['support_type']='normal(auto)'; p['support_on_build_plate_only']='0'
        (OUT/('user_'+kind+'.json')).write_text(json.dumps(p,indent=2),encoding='utf-8')
    results=[]
    for name in ['camera_rail','camera_rail_end','camera_end_left','camera_end_right']:
        folder=OUT/('slice_'+name); folder.mkdir(exist_ok=True)
        command=[EXE,'--arrange','1','--curr-bed-type',c.get('curr_bed_type','Textured PEI Plate'),
                 '--load-settings',str(OUT/'user_machine.json')+';'+str(OUT/'user_process.json'),
                 '--load-filaments',str(OUT/'user_filament.json'),'--slice','0','--debug','2',
                 '--outputdir',str(folder),'--export-3mf','sliced.3mf',str(OUT/(name+'.stl'))]
        run=subprocess.run(command,cwd=folder,capture_output=True,text=True,
                           encoding='utf-8',errors='replace',creationflags=0x08000000,timeout=300)
        (folder/'console.log').write_text(run.stdout+run.stderr,encoding='utf-8')
        r=json.loads((folder/'result.json').read_text())
        if run.returncode or r['return_code']: raise RuntimeError(r)
        plate=r['sliced_plates'][0]
        record={'part':name,'seconds':round(plate['total_predication']),
                'filament_g':round(plate['filaments'][0]['total_used_g'],2),
                'warning':plate.get('warning_message','')}
        results.append(record); print(record,flush=True)
        (OUT/(name+'_0p08mm.3mf')).write_bytes((folder/'sliced.3mf').read_bytes())
    report={'settings_source':project.name,'layer_height_mm':float(c['layer_height']),
            'wall_loops':int(c['wall_loops']),'infill':c['sparse_infill_density'],
            'automatic_supports':True,'built_in_supports':False,
            'not_validated':'Physical breakaway force and printed fit','results':results}
    (OUT/'slicing_report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__': main()
