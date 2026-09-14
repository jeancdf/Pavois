"""PAVOIS V2.1: 55-second cut-based, silent Blender blockout.
Blender --background --python animation/v2/build_film.py -- --stills
"""
import bpy, math, json, sys
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

OUT=Path(__file__).resolve().parent/'output'; OUT.mkdir(exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc=bpy.context.scene; sc.name='PAVOIS / V2.1 / EDIT'
sc.render.engine='BLENDER_EEVEE';sc.eevee.taa_render_samples=16;sc.cycles.samples=8;sc.cycles.use_denoising=True
prefs=bpy.context.preferences.addons['cycles'].preferences
try:
 prefs.compute_device_type='OPTIX';prefs.get_devices()
 for device in prefs.devices:device.use=device.type=='OPTIX'
 if any(d.type=='OPTIX' for d in prefs.devices):sc.cycles.device='GPU'
except Exception:pass
sc.render.use_persistent_data=True
sc.render.resolution_x=960;sc.render.resolution_y=540;sc.render.resolution_percentage=100
sc.render.fps=24;sc.frame_start=1;sc.frame_end=1320
sc.world=bpy.data.worlds.new('Dawn');sc.world.use_nodes=True
sc.world.node_tree.nodes['Background'].inputs[0].default_value=(.16,.21,.27,1)
sc.world.node_tree.nodes['Background'].inputs[1].default_value=.6
sc.view_settings.view_transform='AgX'

def material(n,c,emit=0,alpha=1):
 m=bpy.data.materials.new(n);m.diffuse_color=(*c,alpha);m.use_nodes=True
 nt=m.node_tree;nt.nodes.clear();out=nt.nodes.new('ShaderNodeOutputMaterial')
 if alpha<1:
  m.surface_render_method='BLENDED'
  tr=nt.nodes.new('ShaderNodeBsdfTransparent');e=nt.nodes.new('ShaderNodeEmission');e.inputs[0].default_value=(*c,1);e.inputs[1].default_value=.7
  mix=nt.nodes.new('ShaderNodeMixShader');mix.inputs[0].default_value=alpha
  nt.links.new(tr.outputs[0],mix.inputs[1]);nt.links.new(e.outputs[0],mix.inputs[2]);nt.links.new(mix.outputs[0],out.inputs[0])
 elif emit:
  e=nt.nodes.new('ShaderNodeEmission');e.inputs[0].default_value=(*c,1);e.inputs[1].default_value=emit;nt.links.new(e.outputs[0],out.inputs[0])
 else:
  p=nt.nodes.new('ShaderNodeBsdfPrincipled');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=.7;nt.links.new(p.outputs[0],out.inputs[0])
 return m
navy=material('Graphite',(.045,.065,.085));white=material('Chalk',(.65,.7,.73));land=material('Terrain',(.18,.21,.22));road=material('Asphalt',(.075,.095,.11))
blue=material('Blue / overlay',(.13,.5,1),1);cyan=material('Cyan / overlay',(.05,.8,.85),1);ice=material('Ice / overlay',(.65,.85,1),1)
uiwhite=material('UI / white',(.85,.93,1),1);uidark=material('UI / background',(.015,.03,.05),1);uipanel=material('UI / panel',(.035,.065,.09),1)
skin=material('Operator / clay',(.42,.48,.51));black=material('Lens',(.008,.012,.02))

def finish(o,n,m):o.name=n;o.data.materials.append(m);return o
def box(n,p,s,m):
 bpy.ops.mesh.primitive_cube_add(size=1,location=p);o=finish(bpy.context.object,n,m);o.scale=s;return o
def sphere(n,p,s,m):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=1,location=p);o=finish(bpy.context.object,n,m);o.scale=s;return o
def rod(n,a,b,r,m):
 bpy.ops.mesh.primitive_cylinder_add(vertices=10,radius=r,depth=1);o=finish(bpy.context.object,n,m);place(o,Vector(a),Vector(b));return o
def place(o,a,b):
 o.location=(a+b)/2;o.rotation_mode='QUATERNION';o.rotation_quaternion=(b-a).to_track_quat('Z','Y');o.scale.z=(b-a).length
def line(n,pts,r,m):
 d=bpy.data.curves.new(n,'CURVE');d.dimensions='3D';d.bevel_depth=r;d.bevel_resolution=0;p=d.splines.new('POLY');p.points.add(len(pts)-1)
 for v,c in zip(p.points,pts):v.co=(*c,1)
 o=bpy.data.objects.new(n,d);sc.collection.objects.link(o);d.materials.append(m);return o
def empty(n,p=(0,0,0)):
 o=bpy.data.objects.new(n,None);sc.collection.objects.link(o);o.location=p;return o
def text(n,body,p,size,m,parent=None):
 d=bpy.data.curves.new(n,'FONT');d.body=body;d.size=size
 o=bpy.data.objects.new(n,d);sc.collection.objects.link(o);o.location=p;d.materials.append(m);o.parent=parent;return o
def visibility(o,intervals):
 keys={1:True}
 for a,b in intervals:keys.update({max(1,a-1):True,a:False,b:False,b+1:True})
 for f,v in sorted(keys.items()):
  o.hide_render=v;o.hide_viewport=v;o.keyframe_insert('hide_render',frame=f);o.keyframe_insert('hide_viewport',frame=f)
def pose(o,p,q):o.location=p;o.rotation_mode='QUATERNION';o.rotation_quaternion=(Vector(q)-Vector(p)).to_track_quat('-Z','Y')
def camera(n,lens=40):
 d=bpy.data.cameras.new(n);o=bpy.data.objects.new(n,d);sc.collection.objects.link(o);d.lens=lens;d.clip_end=3000;return o
def target(f):
 t=(f-1)/1319;return Vector((-7+23*t,15+5*t,7+.5*math.sin(t*5)))

# Deliberately simple site, repeated in the operator's vector map.
box('SITE / ground',(0,-35,-.4),(2000,2000,.7),land)
box('SITE / service road',(0,-40,.005),(5,190,.025),road)
for y in range(-125,60,8):box('SITE / road marking',(0,y,.03),(.12,3,.01),white)
buildings=[(-22,15,10,18,4),(24,-17,12,20,5),(-38,-50,18,12,4),(32,-75,15,25,6)]
for x,y,w,h,z in buildings:
 box('SITE / building',(x,y,z/2),(w,h,z),navy)
 box('SITE / roof',(x,y,z+.12),(w+.4,h+.4,.24),white)
for x,y in [(-19,-12),(19,29)]:
 rod('SITE / landmark mast',(x,y,0),(x,y,13),.14,navy)
 line('SITE / mast brace',[(x-2,y,0),(x,y,13),(x+2,y,0)],.06,white)
box('SITE / operator station',(20,18,1.5),(6,5,3),white)
box('SITE / station window',(20,15.45,1.8),(4,.05,1.3),black)

sensor_pos=[(-12,0),(10,2),(-2,-9)]
sensor_pos += [(x+(row%2)*4,y) for row,y in enumerate([-35,-57,-79,-101,-123]) for x in [-60,-36,-12,12,36,60]][:30]
sensor_pos += [(-48,5),(45,-8),(55,18)]
origins=[];obs_cams=[];cone_objects=[]
for i,(x,y) in enumerate(sensor_pos):
 col=[blue,cyan,ice][i%3]; tag=f'CAM {i+1:02}'
 box(tag+' / base',(x,y,.15),(1.3,1.1,.3),navy)
 for dx,dy in [(-.5,-.4),(.5,-.4),(0,.5)]:rod(tag+' / legs',(x+dx,y+dy,.3),(x,y,2.2),.055,white)
 aim=Vector((3,18,7)) if i<3 else Vector((x+3,y+24,8))
 p=Vector((x,y,2.4));head=empty(tag+' / head',p);head.rotation_mode='QUATERNION';head.rotation_quaternion=(aim-p).to_track_quat('-Z','Y')
 body=box(tag+' / body',(0,0,0),(.85,.65,1),white);body.parent=head
 lens=rod(tag+' / lens',(0,0,-.4),(0,0,-.7),.23,black);lens.parent=head
 optical=p+head.rotation_quaternion@Vector((0,0,-.71));origins.append(optical)
 c=camera(tag+' / observation',28);pose(c,optical,aim);obs_cams.append(c)
 # Rectangular fixed frustum, translucent surfaces and thin edges.
 length=(aim-optical).length+9 if i<3 else 31
 hw=length*math.tan(math.radians(32.5));hh=hw*9/16
 corners=[optical+c.rotation_quaternion@Vector((a*hw,b*hh,-length)) for a,b in [(-1,-1),(1,-1),(1,1),(-1,1)]]
 verts=[optical,*corners];mesh=bpy.data.meshes.new(tag+' frustum');mesh.from_pydata(verts,[],[(0,1,2),(0,2,3),(0,3,4),(0,4,1)])
 o=bpy.data.objects.new(tag+' / field of view',mesh);sc.collection.objects.link(o)
 o.data.materials.append(material(tag+' / transparent',[(.13,.5,1),(.05,.8,.85),(.65,.85,1)][i%3],alpha=.045 if i<3 else .018))
 intervals=([(163,504),(1033,1320)] if i==0 else [(349+(i-1)*18,504),(1033+i*2,1320)]) if i<3 else [(1050+(i//6)*16,1320)]
 visibility(o,intervals);cone_objects.append(o)
 for j in range(4):
  ed=line(tag+' / field edge',[optical,corners[j]],.012 if i<3 else .018,col);visibility(ed,intervals);cone_objects.append(ed)
 if i<3:
  tx=text(tag+' / label',tag,(x-1,y-1,.04),.42,col)

drone=empty('DRONE / flight')
pieces=[box('DRONE / body',(0,0,0),(.8,1.15,.3),white),box('DRONE / battery',(0,0,.23),(.45,.7,.15),navy)]
rotors=[]
for x in [-.85,.85]:
 for y in [-.7,.7]:
  pieces += [rod('DRONE / arm',(0,0,0),(x,y,0),.08,navy),rod('DRONE / motor',(x,y,0),(x,y,.2),.13,black)]
  r=empty('DRONE / rotor',(x,y,.23));r.parent=drone;rotors.append(r)
  b=box('DRONE / propeller',(0,0,0),(1,.09,.025),navy);b.parent=r
pieces.append(sphere('DRONE / optic',(0,.57,-.06),(.15,.13,.13),black))
for o in pieces:o.parent=drone
rays=[]
for i,a in enumerate(origins[:3]):
 o=rod('TRACK / direction '+str(i),a,target(450),.022,[blue,cyan,ice][i]);visibility(o,[(433,504)]);rays.append(o)
halo=empty('TRACK / estimate')
for z in [0]:
 o=line('TRACK / estimate ring',[(.7*math.cos(t*math.pi/16),.7*math.sin(t*math.pi/16),z) for t in range(33)],.025,cyan);o.parent=halo;visibility(o,[(451,504)])

# Separate, minimal interior set: torso, head, arms, desk and screen.
O=Vector((1000,0,0))
def ip(p):return O+Vector(p)
box('ROOM / floor',ip((0,0,-.1)),(12,12,.2),navy)
box('ROOM / rear wall',ip((0,3,2.5)),(12,.2,5),navy)
box('ROOM / desk',ip((0,.2,1.05)),(3.8,1.65,.12),white)
for x in [-1.5,1.5]:box('ROOM / desk leg',ip((x,.2,.5)),(.12,.12,1),navy)
box('OPERATOR / chair',ip((0,-1.25,.65)),(.8,.8,.2),navy)
box('OPERATOR / chair back',ip((0,-1.6,1.2)),(.8,.14,1),navy)
sphere('OPERATOR / torso',ip((0,-1.05,1.25)),(.4,.28,.62),skin)
sphere('OPERATOR / head',ip((0,-.91,2)),(.24,.24,.32),skin)
sphere('OPERATOR / nose',ip((0,-.65,2)),(.085,.11,.075),skin)
for x in [-.095,.095]:sphere('OPERATOR / eye',ip((x,-.684,2.095)),(.025,.018,.015),black)
for x in [-.36,.36]:
 rod('OPERATOR / upper arm',ip((x,-1,1.6)),ip((x*1.45,-.65,1.15)),.105,skin)
 rod('OPERATOR / forearm',ip((x*1.45,-.65,1.15)),ip((x*1.4,-.1,1.16)),.09,skin)
 sphere('OPERATOR / hand',ip((x*1.4,-.04,1.17)),(.11,.17,.065),skin)
 rod('OPERATOR / thigh',ip((x*.6,-1.1,.8)),ip((x*.6,-.45,.5)),.15,navy)
 rod('OPERATOR / shin',ip((x*.6,-.45,.5)),ip((x*.6,-.35,.1)),.12,navy)
box('PC / keyboard',ip((-.2,-.25,1.14)),(.9,.32,.035),navy)
box('PC / mouse',ip((.55,-.03,1.15)),(.13,.22,.07),black)
box('PC / tower',ip((1.95,.25,.45)),(.4,.6,.8),navy)
rod('PC / screen stand',ip((0,.65,1.1)),ip((0,.65,1.7)),.07,navy)
screen=empty('PC / screen coordinate system',ip((0,.58,2)))
screen.rotation_euler=(math.pi/2,0,0) # local XY faces operator (-Y)
o=box('PC / bezel',(0,0,-.04),(2.9,1.7,.08),black);o.parent=screen

def panel(n,x,y,w,h,m=uipanel):
 o=box(n,(x,y,0 if n=='UI / background' else .014),(w,h,.008),m);o.parent=screen;return o
def uit(body,x,y,size=.06,m=uiwhite):return text('UI / '+body,body,(x,y,.065),size,m,screen)
panel('UI / background',0,0,2.76,1.55,uidark)
uit('PAVOIS  /  SURVEILLANCE',-1.28,.66,.085)
uit('SIMULATION',.78,.68,.045,cyan)
panel('UI / map',-.38,-.03,1.72,1.15)
def mapxy(p):return Vector((-.42+p[0]*.022,-.24+p[1]*.022,.025))
o=box('UI / road',(-.42,-.02,.025),(.11,.88,.004),uidark);o.parent=screen
for x,y,w,h,z in buildings[:2]:
 p=mapxy((x,y));o=box('UI / building',(p.x,p.y,.03),(w*.022,h*.022,.004),uiwhite);o.parent=screen
for i,p in enumerate(sensor_pos[:3]):
 v=mapxy(p);o=sphere('UI / camera icon',v,(.026,.026,.01),[blue,cyan,ice][i]);o.parent=screen
 uit(f'C{i+1}',v.x+.025,v.y,.035)
trace=line('UI / observed trace',[mapxy(target(f)) for f in range(433,817,4)],.009,cyan);trace.parent=screen
for f in range(433,818,4):trace.data.bevel_factor_end=min(1,(f-433)/380);trace.data.keyframe_insert('bevel_factor_end',frame=f)
mp=sphere('UI / tracked point',(0,0,.035),(.03,.03,.012),cyan);mp.parent=screen
uit('PISTE 01',-1.19,-.69,.058,cyan);uit('Position estimee  /  3 observations',-.67,-.69,.038)
# Camera vignettes use genuine virtual-camera projection of the same world.
mini=[]
for i in range(3):
 cx,cy=.93,.35-i*.39;panel('UI / live view '+str(i),cx,cy,.66,.32)
 uit(f'CAM 0{i+1}',cx-.29,cy+.115,.04,cyan)
 # Project landscape silhouettes into each vignette; line geometry is sufficient for blockout.
 c=obs_cams[i];bpy.context.view_layer.update()
 for x,y,w,h,z in buildings[:2]:
  pts=[]
  for p in [(x-w/2,y,z),(x+w/2,y,z),(x+w/2,y,0),(x-w/2,y,0),(x-w/2,y,z)]:
   v=world_to_camera_view(sc,c,Vector(p));pts.append((cx+(max(0,min(1,v.x))-.5)*.61,cy+(max(0,min(1,v.y))-.5)*.25,.02))
  o=line('UI / projected terrain',[(x,y,.04) for x,y,z in pts],.003,uiwhite);o.parent=screen
 root=empty('UI / projected drone '+str(i));root.parent=screen
 for pts in [[(-.022,-.012,.04),(.022,.012,.04)],[(-.022,.012,.04),(.022,-.012,.04)]]:
  o=line('UI / drone silhouette',pts,.004,cyan);o.parent=root
 mini.append((root,c,cx,cy))

# Fifteen shots, real camera cuts via timeline markers.
shots=[]
def shot(n,a,b,lens,p,q,p2=None,q2=None,follow=False,title=None):
 c=camera(n,lens);shots.append(dict(name=n,start=a,end=b,camera=c,p=p,q=q,p2=p2 or p,q2=q2 or q,follow=follow,title=title))
 mark=sc.timeline_markers.new(n,frame=a);mark.camera=c;return c
shot('01 / Drone tracking',1,120,65,(4,-11,4),(0,0,0),(3,-11,3.5),(0,0,0),True)
a=origins[0];d=obs_cams[0].rotation_quaternion@Vector((0,0,-1))
shot('02 / Lens insert',121,138,85,a+d*2.6+Vector((.45,0,.15)),a)
shot('03 / One observer',139,288,45,(15.33,-11.38,10.45),(-7.65,7.9,4.45),(14.9,-11.1,10.45),(-7.65,7.9,4.45),title='UN PREMIER REGARD.')
for i,fr in [(1,289),(2,313)]:
 a=origins[i];d=obs_cams[i].rotation_quaternion@Vector((0,0,-1));shot('04 / CAM 02' if i==1 else '05 / CAM 03',fr,fr+23,50,a+d*5+Vector((3,0,1)),a)
shot('06 / Three viewpoints',337,504,32,(29,-32,22),(0,9,4),(27,-32,22),(0,9,4),title='TROIS POINTS DE VUE.')
shot('07 / Operator portrait',505,624,65,ip((1.8,.5,2.25)),ip((0,-.88,1.95)))
shot('08 / Over shoulder',625,720,50,ip((1.15,-3.4,2.8)),ip((0,.58,1.9)),title="UNE VUE D'ENSEMBLE.")
screen_cam=shot('09 / Screen insert',721,792,48,ip((0,.32,2)),ip((0,.58,2)))
screen_cam.data.type='ORTHO';screen_cam.data.ortho_scale=3.05
map_cam=shot('09B / Map insert',793,816,48,ip((-.38,.32,1.97)),ip((-.38,.58,1.97)))
map_cam.data.type='ORTHO';map_cam.data.ortho_scale=1.8
match_center=(.04/.022,.21/.022)
top_cam=shot('10 / Graphic match overhead',817,864,40,(*match_center,65),(*match_center,0))
top_cam.data.type='ORTHO';top_cam.data.ortho_scale=1.8/.022
shot('11 / Drone lateral',865,960,50,(7,-3,1.8),(0,0,0),(7,-1,1.8),(0,0,0),True)
shot('12 / Flight axis',961,984,40,(0,-7,1),(0,3,0),follow=True)
shot('13 / Reverse and network reveal',985,1224,24,(12,30,11),(3,0,3),(105,105,105),(0,-43,0),title="ET SI L'ON CHANGEAIT D'ECHELLE ?")
shot('14 / Signature',1225,1320,24,(105,105,105),(0,-43,0),title='P A V O I S')

def hud(cam,body,sub=None):
 # Fixed angular layout: consistent screen placement despite shot focal lengths.
 width=2*cam.data.sensor_width/cam.data.lens;height=width*9/16
 o=text('TITLE / '+body,body,(-width*.44,height*.37,-2),width*.032,uiwhite,cam)
 if sub:text('TITLE / subtitle',sub,(-width*.44,height*.29,-2),width*.018,cyan,cam)
 return o
for sh in shots:
 if sh['title']:
  sub='Projection de deploiement' if sh['start']==985 else ('Croiser les regards. Situer le mouvement.' if sh['start']==1225 else None)
  o=hud(sh['camera'],sh['title'],sub)
  if sh['start']==337:
   visibility(o,[(337,432)]);o2=hud(sh['camera'],'UNE POSITION ESTIMEE.');visibility(o2,[(433,504)])

for f in range(1,1321):
 p=target(f);drone.location=p;drone.rotation_euler=(.05*math.sin(f/45),.10*math.sin(f/60),-.25)
 drone.keyframe_insert('location',frame=f);drone.keyframe_insert('rotation_euler',frame=f)
 halo.location=p;halo.keyframe_insert('location',frame=f)
 for i,o in enumerate(rays):
  place(o,origins[i],p)
  for k in ['location','rotation_quaternion','scale']:o.keyframe_insert(k,frame=f)
 for i,r in enumerate(rotors):r.rotation_euler.z=f*.8*(-1 if i%2 else 1);r.keyframe_insert('rotation_euler',frame=f)
 mp.location=mapxy(p)+Vector((0,0,.02));mp.keyframe_insert('location',frame=f)
 for root,c,cx,cy in mini:
  v=world_to_camera_view(sc,c,p);root.location=(cx+(v.x-.5)*.61,cy+(v.y-.5)*.25,.025);root.keyframe_insert('location',frame=f)
 for sh in shots:
  if sh['start']<=f<=sh['end']:
   u=(f-sh['start'])/max(1,sh['end']-sh['start']);u=u*u*(3-2*u)
   cp=Vector(sh['p']).lerp(Vector(sh['p2']),u);cq=Vector(sh['q']).lerp(Vector(sh['q2']),u)
   if sh['follow']:cp+=p;cq+=p
   c=sh['camera'];pose(c,cp,cq);c.keyframe_insert('location',frame=f);c.keyframe_insert('rotation_quaternion',frame=f)
   break

# All camera-local titles must be hidden outside their shot (they are real geometry).
for sh in shots:
 for o in sh['camera'].children:
  if not o.animation_data:visibility(o,[(sh['start']+72 if sh['start']==985 else sh['start'],sh['end'])])

sun=bpy.data.lights.new('Sunrise','SUN');sun.energy=2;sun.angle=.15
o=bpy.data.objects.new('Sunrise',sun);sc.collection.objects.link(o);o.rotation_euler=(.5,-.6,-.4)
for name,p,energy,size in [('ROOM / screen glow',ip((0,.2,2.2)),90,2),('ROOM / softbox',ip((2,-2,4)),180,4)]:
 d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);sc.collection.objects.link(o);pose(o,p,ip((0,-1,1.5)))
sc.frame_set(380);sc.camera=shots[5]['camera']
for screen_ui in bpy.data.screens:
 for area in screen_ui.areas:
  if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA';area.spaces.active.shading.type='MATERIAL'
sc.render.image_settings.file_format='PNG';sc.render.filepath=str(OUT/'frames'/'frame_')
manifest=[{k:v for k,v in sh.items() if k in ['name','start','end','title']} for sh in shots]
(OUT/'edit.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'pavois_film_v2.blend'))
if '--stills' in sys.argv:
 for sh in shots:
  f=(sh['start']+sh['end'])//2;sc.frame_set(f);sc.camera=sh['camera'];sc.render.filepath=str(OUT/f'shot_{sh["start"]:04}.png');bpy.ops.render.render(write_still=True)
print('FINISHED',OUT)
