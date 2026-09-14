"""Read-only Blender checks for edit coverage, graphic match and key framing."""
import bpy,json
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
s=bpy.context.scene
out=Path(__file__).resolve().parent/'output'
edit=json.loads((out/'edit.json').read_text())
assert edit[0]['start']==1 and edit[-1]['end']==1320
assert all(a['end']+1==b['start'] for a,b in zip(edit,edit[1:]))
assert len(edit)==15
assert len([o for o in s.objects if o.name.endswith('/ observation')])==36
assert s.render.fps==24
def setframe(f):
 s.frame_set(f);s.camera=max((m for m in s.timeline_markers if m.frame<=f and m.camera),key=lambda m:m.frame).camera
 return s.camera
def proj(o):
 v=world_to_camera_view(s,s.camera,o.matrix_world.translation)
 return [round(v.x,5),round(v.y,5),round(v.z,3)]
setframe(816);a=proj(s.objects['UI / tracked point'])
setframe(817);b=proj(s.objects['DRONE / flight'])
assert abs(a[0]-b[0])<.005 and abs(a[1]-b[1])<.005,(a,b)
setframe(1320)
views=[proj(o) for o in s.objects if o.name.endswith('/ observation')]
inside=sum(0<x<1 and 0<y<1 and z>0 for x,y,z in views)
assert inside>=30,inside
samples=[]
for f in [1,60,120,139,210,288,337,450,504,817,864,865,960,961,984,985]:
 setframe(f);p=proj(s.objects['DRONE / flight']);samples.append({'frame':f,'drone_uv_depth':p})
 assert 0<p[0]<1 and 0<p[1]<1 and p[2]>0,(f,p)
report={'duration_seconds':1320/24,'shots':len(edit),'network_cameras':36,'final_cameras_in_frame':inside,'match_map':a,'match_drone':b,'subject_framing':samples}
(out/'verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
