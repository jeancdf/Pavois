"""Verify automatic support settings and actual support extrusion in both 3MFs."""
from pathlib import Path
from collections import Counter
import json
import re
import zipfile

OUT=Path(__file__).resolve().parent/'modular_rig_v05'
results=[]
for name in ['camera_rail','camera_rail_end','camera_end_left','camera_end_right']:
    with zipfile.ZipFile(OUT/(name+'_0p08mm.3mf')) as archive:
        config=json.loads(archive.read('Metadata/project_settings.config'))
        lines=archive.read('Metadata/plate_1.gcode').decode().splitlines()
    assert config['enable_support']=='1'
    assert config['support_type']=='normal(auto)'
    assert config['support_on_build_plate_only']=='0'
    counts=Counter()
    feature=''
    relative=False
    for line in lines:
        if line.startswith('; FEATURE:'): feature=line.split(':',1)[1].strip()
        cmd=line.split(';')[0].strip()
        if cmd=='M83': relative=True
        if cmd=='M82': relative=False
        if not re.match(r'^G[01] ',cmd): continue
        values={k:float(v) for k,v in re.findall(r'([XYE])(-?\d*\.?\d+)',cmd)}
        if feature.startswith('Support') and values.get('E',0)>0 and ('X' in values or 'Y' in values):
            assert relative
            counts[feature]+=1
    assert counts['Support']>0 and counts['Support interface']>0
    results.append({'part':name,'automatic_supports':True,'support_extrusion_moves':dict(counts),'pass':True})
report={'profile':'Supplied A1 mini 0.08 mm 3MF',
        'checks':'Automatic normal supports enabled, including on model; generated extrusion exists',
        'physical_removal_test_required':True,'results':results}
(OUT/'support_toolpath_checks.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,indent=2))
