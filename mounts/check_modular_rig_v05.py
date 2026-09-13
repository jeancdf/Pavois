"""Verify a continuous camera insertion, with removable print supports absent.
The lower 10.01 mm is decomposed into convex source primitives and checked
against mount(). Sweeping each convex primitive is exactly its endpoint hull.
"""
from pathlib import Path
import json
import subprocess
import tempfile
import numpy as np
import trimesh

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'modular_rig_v05'
EXE='C:/Program Files/OpenSCAD/openscad.com'


def render(source, output, allow_empty=False):
    p=subprocess.run([EXE,'-o',str(output),str(source)],capture_output=True,
                     text=True,encoding='utf-8',errors='replace')
    log=p.stdout+p.stderr
    if 'ERROR:' in log or any('WARNING:' in l and '2-manifold' not in l for l in log.splitlines()):
        raise RuntimeError(log)
    if output.exists():
        return trimesh.load_mesh(output)
    if allow_empty and 'Current top level object is empty' in log:
        return None
    raise RuntimeError(log)


def volume(mesh):
    with np.errstate(invalid='ignore',divide='ignore'):
        return 0 if mesh is None else abs(float(mesh.volume))


def main():
    with tempfile.TemporaryDirectory(prefix='pavois-insertion-') as tmp:
        temp=Path(tmp)
        header=f'use <{(ROOT/"camera_mount_v2_pi25.scad").as_posix()}>\n'
        clip='translate([-100,-200,-0.01]) cube([200,400,10.02]);'
        parts=[]
        for name,body in [('base','base();'),('rib','rib();'),('plate','in_plate_frame() plate_body();'),('actual','mount();')]:
            src=temp/(name+'.scad'); dst=temp/(name+'.stl')
            src.write_text(header+'intersection(){'+body+clip+'}',encoding='utf-8')
            mesh=render(src,dst)
            assert mesh.is_watertight
            if name!='actual':
                # Every vertex must lie on or behind each outward face plane.
                distances=np.einsum('fvi,fi->fv',mesh.vertices[None,:,:]-mesh.triangles_center[:,None,:],mesh.face_normals)
                assert float(distances.max())<0.001, (name,distances.max())
                parts.append('intersection(){'+body+clip+'}')
            print('Rendered '+name,flush=True)
        union='union(){'+''.join(parts)+'}'
        actual='intersection(){mount();'+clip+'}'
        errors=[]
        for i,(a,b) in enumerate([(union,actual),(actual,union)]):
            src=temp/f'equality{i}.scad'; dst=temp/f'equality{i}.stl'
            src.write_text(header+'difference(){'+a+b+'}',encoding='utf-8')
            errors.append(volume(render(src,dst,True)))
        assert max(errors)<0.01, errors
        sweep_source=temp/'sweep.scad'; sweep_path=temp/'sweep.stl'
        sweep_body='union(){'+''.join(
            f'hull(){{{p} translate([0,-160,0]) {p}}}'
            for p in parts)+'}'
        sweep_source.write_text(header+sweep_body,encoding='utf-8')
        sweep=render(sweep_source,sweep_path)
        assert sweep.is_watertight
        print('Continuous sweep of three verified convex components rendered',flush=True)
        results=[]
        cases=[('v5_camera_clear',OUT/'camera_rail.stl',8,False),
               ('v5_terminal_clear',OUT/'camera_end_right.stl',8,False),
               ('v5_left_clear',OUT/'camera_end_left.stl',8,False)]
        for name,rail,z,blocked in cases:
            src=temp/(name+'.scad'); dest=temp/(name+'.stl')
            src.write_text(header+'intersection(){'+f'import("{rail.as_posix()}");'
                           f'translate([1000/14,0,{z}]) '+sweep_body+'}',encoding='utf-8')
            overlap=volume(render(src,dest,True))
            passed=overlap>0.01 if blocked else overlap<0.01
            record={'case':name,'intersection_mm3':round(overlap,5),'expected_blockage':blocked,'pass':passed}
            results.append(record); print(record,flush=True)
        report={'motion':'Continuous straight translation Y=-160..0 mm; X=1000/14, constant Z',
                'reference':'Source V2, lower 10.01 mm; rail obstacles stop at Z=18, floor at Z=8',
                'method':'Union of endpoint hulls of three convex primitives; exact decomposition verified against mount()',
                'decomposition_difference_mm3':errors,
                'supports':'Must be removed before sliding the camera; production STL used for clearance',
                'not_validated':'Printed dimensions, electronics/cables, breakaway force',
                'results':results}
        (OUT/'insertion_checks.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        if not all(r['pass'] for r in results): raise SystemExit('Insertion check failed')


if __name__=='__main__': main()
