"""Build PAVOIS's silent, editable 3D animatic. Run with Blender --background --python.

No handlers, external assets, or add-ons are required when reopening the blend.
Outputs live beside this script in output/. Existing user scenes are untouched.
"""
from pathlib import Path
import math
import sys
import bpy
from mathutils import Vector

OUT = Path(__file__).resolve().parent / 'output'
OUT.mkdir(exist_ok=True)
FPS, END = 24, 768
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.name = 'PAVOIS • Du mouvement à la position'
sc.render.engine = 'CYCLES'
sc.cycles.samples = 24
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
sc.render.resolution_percentage = 100
sc.render.fps = FPS
sc.frame_start, sc.frame_end = 1, END
sc.unit_settings.system = 'METRIC'
sc.world = bpy.data.worlds.new('Night studio')
sc.world.use_nodes = True
sc.world.node_tree.nodes['Background'].inputs[0].default_value = (.055,.08,.13,1)
sc.world.node_tree.nodes['Background'].inputs[1].default_value = .45

def mat(name, rgb, metal=0, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*rgb, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = .36
    p.inputs['Emission Color'].default_value = (*rgb, 1)
    p.inputs['Emission Strength'].default_value = emission
    return m

navy = mat('01 • Midnight enamel', (.022,.04,.075), .5)
ground = mat('02 • Slate stage', (.033,.053,.08), .15)
white = mat('03 • Ceramic ivory', (.72,.82,.9), .3)
black = mat('04 • Optical glass', (.006,.012,.022), .75)
blue = mat('05 • View A / blue', (.055,.3,1), .1, 2)
cyan = mat('06 • View B / cyan', (.02,.85,.85), .1, 2)
amber = mat('07 • View C / amber', (1,.45,.08), .1, 2)
gridmat = mat('08 • Grid lines', (.07,.12,.19), 0, .25)
typewhite = mat('09 • Type white', (.8,.9,1), 0, 1)

def finish(o, name, material):
    o.name = name
    o.data.materials.append(material)
    return o

def box(name, pos, size, material, bevel=.04):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    o=finish(bpy.context.object,name,material)
    o.dimensions=size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        m=o.modifiers.new('Soft manufactured edges','BEVEL');m.width=bevel;m.segments=3
        o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return o

def sphere(name, pos, radius, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10, radius=radius, location=pos)
    o=finish(bpy.context.object,name,material)
    for p in o.data.polygons:p.use_smooth=True
    return o

def rod(name,a,b,r,material):
    a,b=Vector(a),Vector(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=r, depth=1)
    o=finish(bpy.context.object,name,material)
    place_rod(o,a,b,r)
    return o

def place_rod(o,a,b,r=None):
    d=b-a
    o.location=(a+b)/2
    o.rotation_mode='QUATERNION'
    o.rotation_quaternion=d.to_track_quat('Z','Y')
    o.scale.z=d.length

def curve(name, points, radius, material):
    d=bpy.data.curves.new(name,'CURVE');d.dimensions='3D';d.bevel_depth=radius;d.bevel_resolution=2
    p=d.splines.new('POLY');p.points.add(len(points)-1)
    for v,co in zip(p.points,points):v.co=(*co,1)
    o=bpy.data.objects.new(name,d);sc.collection.objects.link(o);d.materials.append(material)
    return o

def text(name,body,pos,size,material,rot=(0,0,0)):
    d=bpy.data.curves.new(name,'FONT');d.body=body;d.size=size;d.extrude=.001
    o=bpy.data.objects.new(name,d);sc.collection.objects.link(o);o.location=pos;o.rotation_euler=rot;d.materials.append(material)
    return o

def visible(o,start,stop=END):
    for f,v in [(1,True),(max(1,start-1),True),(start,False),(stop,False),(stop+1,True)]:
        o.hide_render=v;o.hide_viewport=v
        o.keyframe_insert('hide_render',frame=f);o.keyframe_insert('hide_viewport',frame=f)

def empty(name,pos=(0,0,0)):
    o=bpy.data.objects.new(name,None);sc.collection.objects.link(o);o.location=pos;return o

def parent_local(o,p):o.parent=p

box('STAGE / rounded observation platform',(0,8,-.4),(32,32,.7),ground,.5)
for i in range(-14,17,2):
    curve('STAGE / grid X',[(i,-6,-.035),(i,22,-.035)],.009,gridmat)
for i in range(-6,23,2):
    curve('STAGE / grid Y',[(-14,i,-.035),(16,i,-.035)],.009,gridmat)
text('STAGE / identity','P A V O I S',(-12,-5,.015),1.0,white)
text('STAGE / subtitle','OPTICAL OBSERVATION  /  3D POSITION',(-12,-6,.015),.24,white)

origins=[]
for tag,pos,col in [('A',(-7,0,0),blue),('B',(7,0,0),cyan),('C',(0,-4,0),amber)]:
    x,y,z=pos
    box('SENSOR '+tag+' / base',(x,y,.14),(1.5,1.3,.28),navy,.1)
    for dx,dy in [(-.6,-.5),(.6,-.5),(0,.55)]:
        rod('SENSOR '+tag+' / strut',(x+dx,y+dy,.3),(x,y,1.75),.055,white)
    rod('SENSOR '+tag+' / mast',(x,y,.3),(x,y,2.1),.11,navy)
    head=empty('SENSOR '+tag+' / optical head',(x,y,2.1))
    head.rotation_mode='QUATERNION';head.rotation_quaternion=(Vector((0,15,6))-head.location).to_track_quat('-Y','Z')
    body=box('SENSOR '+tag+' / housing',(0,0,0),(.8,1,.58),white,.1);parent_local(body,head)
    lens=rod('SENSOR '+tag+' / lens barrel',(0,-.45,0),(0,-.73,0),.22,navy);parent_local(lens,head)
    glass=rod('SENSOR '+tag+' / glass',(0,-.735,0),(0,-.75,0),.175,black);parent_local(glass,head)
    led=sphere('SENSOR '+tag+' / status',(.27,-.515,.15),.035,col);parent_local(led,head)
    box('SENSOR '+tag+' / compute module',(x,y+.45,.5),(.65,.38,.35),navy)
    text('SENSOR '+tag+' / floor label','VIEW '+tag,(x-1,y-1.1,.015),.36,col)
    bpy.context.view_layer.update()
    origins.append(head.matrix_world @ Vector((0,-.75,0)))

drone=empty('TARGET / animated drone')
parts=[box('TARGET / central shell',(0,0,0),(.75,1,.3),white,.12),box('TARGET / battery',(0,.05,.22),(.38,.6,.18),navy)]
rotors=[]
for x in [-.8,.8]:
    for y in [-.65,.65]:
        parts.append(rod('TARGET / carbon arm',(0,0,0),(x,y,.02),.075,navy))
        parts.append(rod('TARGET / motor',(x,y,0),(x,y,.22),.12,white))
        rotor=empty('TARGET / rotor',(x,y,.25));rotor.parent=drone
        blade=box('TARGET / propeller',(0,0,0),(.85,.08,.024),black,.02);blade.parent=rotor;rotors.append(rotor)
        parts.append(rod('TARGET / landing leg',(x*.55,y*.6,-.1),(x*.6,y*.7,-.38),.035,navy))
parts.append(sphere('TARGET / front optic',(0,-.52,-.04),.13,black))
for p in parts:p.parent=drone

def target(f):
    if f<144:return Vector((-3+3*(f-1)/143,15,6))
    if f<528:return Vector((0,15,6))
    t=(f-528)/(END-528)
    return Vector((6*t,15+2*t,6+1.0*math.sin(t*2)))

rays=[]
for i,(a,col) in enumerate(zip(origins,[blue,cyan,amber])):
    o=rod('GEOMETRY / observation ray '+str(i+1),a,target(144),.023,col)
    visible(o,[145,313,409][i]);rays.append(o)

for distance in [.5,1.3,1.65]:
    p=origins[0]+(target(144)-origins[0])*distance
    o=sphere('GEOMETRY / possible depth',p,.16,blue);visible(o,205,312)

# A wire volume marks an estimated region, not a measured uncertainty value.
halo=empty('GEOMETRY / estimated region')
for axis in range(3):
    points=[]
    for n in range(65):
        t=n*2*math.pi/64;p=[.55*math.cos(t),.55*math.sin(t),0]
        if axis==1:p=[p[0],0,p[1]]
        if axis==2:p=[0,p[0],p[1]]
        points.append(p)
    o=curve('GEOMETRY / estimate ring',points,.013,cyan);o.parent=halo;visible(o,361)

track=curve('TRACK / observed trajectory',[target(f) for f in range(528,769,4)],.025,cyan)
visible(track,529)
for f in range(528,769,4):
    track.data.bevel_factor_end=(f-528)/240;track.data.keyframe_insert('bevel_factor_end',frame=f)
for f in range(544,769,24):
    p=target(f);o=sphere('TRACK / sample '+str(f),p,.065,white);visible(o,f)

camdata=bpy.data.cameras.new('DIRECTOR / camera');cam=bpy.data.objects.new('DIRECTOR / camera',camdata);sc.collection.objects.link(cam);sc.camera=cam
cam.rotation_mode='QUATERNION';camdata.clip_end=500

def lerp(a,b,t):return Vector(a).lerp(Vector(b),t*t*(3-2*t))

# Four editorial shots, individually baked: no Python required for playback.
shots=[(1,144,(-15,-19,11),(-13,-18,11.6),(-2,6,2.5),(-1,7,2.8),38),
       (145,312,(20,-24,17),(23,-20,18),(0,8,3),(0,9,3.5),36),
       (313,528,(23,-20,18),(18,-25,19),(0,9,3.5),(0,9,3.5),36),
       (529,768,(18,-25,19),(16,-24,28),(0,9,3.5),(2,7,3),36)]
for start,stop,*_ in shots:
    sc.timeline_markers.new({1:'01 / Optical sensor',145:'02 / Direction, depth unknown',313:'03 / Cross viewpoints',529:'04 / Track in 3D'}[start],frame=start)
for f in range(1,END+1):
    p=target(f);drone.location=p;drone.keyframe_insert('location',frame=f)
    halo.location=p;halo.keyframe_insert('location',frame=f)
    for j,o in enumerate(rays):
        # Extend first ray during the depth ambiguity, then end at the estimate.
        end=origins[j]+(p-origins[j])*(1.8 if j==0 and f<=312 else 1)
        place_rod(o,origins[j],end)
        for prop in ['location','rotation_quaternion','scale']:o.keyframe_insert(prop,frame=f)
    for j,r in enumerate(rotors):
        r.rotation_euler.z=f*.7*(1 if j%2 else -1);r.keyframe_insert('rotation_euler',frame=f)
    for start,stop,a,b,c,d,lens in shots:
        if start<=f<=stop:
            t=(f-start)/(stop-start);cam.location=lerp(a,b,t);look=lerp(c,d,t)
            cam.rotation_quaternion=(look-cam.location).to_track_quat('-Z','Y');camdata.lens=lens
            cam.keyframe_insert('location',frame=f);cam.keyframe_insert('rotation_quaternion',frame=f);camdata.keyframe_insert('lens',frame=f)
            break

# Camera-space typography is an editable 3D object and uses Blender's built-in font.
for start,stop,title,sub in [(1,144,'P A V O I S','01   /   OBSERVATION OPTIQUE'),(145,312,'UNE DIRECTION','02   /   LA PROFONDEUR RESTE INCONNUE'),(313,528,'UNE POSITION 3D','03   /   CROISER LES POINTS DE VUE'),(529,768,'UNE TRAJECTOIRE','04   /   SUIVRE LES OBSERVATIONS')]:
    for body,y,size,ma in [(title,.39,.065,typewhite),(sub,.32,.022,cyan)]:
        o=text('TITLES / '+body,body,(-.76,y,-2),size,ma);o.parent=cam;visible(o,start,stop)
caption=text('TITLES / simulation note','SCENE DE PRINCIPE  /  DONNEES SIMULEES',(-.76,-.435,-2),.018,typewhite);caption.parent=cam

for name,pos,power,size in [('Key', (0,6,18),6500,14),('Cool rim',(-12,12,10),4200,10),('Front',(4,-12,9),4800,10)]:
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size
    o=bpy.data.objects.new(name,d);sc.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector((0,8,0))-o.location).to_track_quat('-Z','Y').to_euler()

# Open directly in camera view at the triangulation reveal.
sc.frame_set(450)
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='MATERIAL'
sc.render.image_settings.file_format='PNG'
sc.render.filepath=str(OUT/'frames'/'pavois_')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'pavois_intro.blend'))
if '--stills' in sys.argv:
    sc.render.resolution_percentage=75
    for f in [80,260,450,680]:
        sc.frame_set(f);sc.render.filepath=str(OUT/f'preview_{f:04}.png');bpy.ops.render.render(write_still=True)
if '--preview' in sys.argv:
    # Fast solid-shaded motion proof; final materials remain stored in the blend.
    sc.render.engine='BLENDER_WORKBENCH'
    sc.display.shading.light='STUDIO';sc.display.shading.color_type='MATERIAL'
    sc.display.shading.show_shadows=True;sc.display.shading.show_cavity=True
    sc.display.shading.background_type='WORLD'
    sc.render.resolution_percentage=50
    sc.frame_step=2
    (OUT/'animatic_frames').mkdir(exist_ok=True)
    sc.render.filepath=str(OUT/'animatic_frames'/'frame_')
    bpy.ops.render.render(animation=True)
print('PAVOIS_OUTPUT',OUT)
