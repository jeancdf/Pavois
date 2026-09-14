"""Procedural landscape, perimeter and product detailing for the V3 film."""
import bpy,math,random
from mathutils import Vector

def refine(g):
 sc=g['sc'];box=g['box'];sphere=g['sphere'];rod=g['rod'];line=g['line'];mat=g['material'];text=g['text'];ip=g['ip'];visibility=g['visibility']
 rng=random.Random(28)
 sc.eevee.shadow_pool_size='512';sc.eevee.shadow_ray_count=2;sc.eevee.shadow_step_count=8
 sc.render.film_transparent=False
 sc.render.use_motion_blur=True;sc.render.motion_blur_shutter=.3;sc.eevee.motion_blur_steps=1
 sc.view_settings.look='AgX - Medium High Contrast'
 # More precise geometry with bevels on manufactured objects.
 for o in list(sc.objects):
  if o.type!='MESH' or o.name.startswith(('UI /','SITE / ground','SITE / road','CAM')):continue
  if len(o.data.vertices)==8:
   dims=list(o.dimensions);bpy.context.view_layer.objects.active=o;o.select_set(True)
   for other in bpy.context.selected_objects:
    if other!=o:other.select_set(False)
   bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
   b=o.modifiers.new('Manufactured edge radius','BEVEL');b.width=min(.06,min(dims)*.15);b.segments=3
   o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
   o.select_set(False)
  else:
   for f in o.data.polygons:f.use_smooth=True
 # No shadow casting from mathematical overlays, especially in the large network shot.
 for o in sc.objects:
  if any(k in o.name for k in ['/ field','TITLE /','UI /','TRACK /']):o.visible_shadow=False
 for m in bpy.data.materials:
  if 'transparent' in m.name:m.use_transparent_shadow=False

 def textured(m,c1,c2,scale=5,bump=.12):
  nt=m.node_tree;p=next((n for n in nt.nodes if n.type=='BSDF_PRINCIPLED'),None)
  if not p:return
  tex=nt.nodes.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=scale;tex.inputs['Detail'].default_value=3
  ramp=nt.nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(*c1,1);ramp.color_ramp.elements[1].color=(*c2,1)
  nt.links.new(tex.outputs['Fac'],ramp.inputs[0]);nt.links.new(ramp.outputs[0],p.inputs['Base Color'])
  b=nt.nodes.new('ShaderNodeBump');b.inputs['Strength'].default_value=bump;b.inputs['Distance'].default_value=.06
  nt.links.new(tex.outputs['Fac'],b.inputs['Height']);nt.links.new(b.outputs[0],p.inputs['Normal'])
 textured(g['land'],(.035,.065,.025),(.19,.235,.10),95,.35)
 textured(g['road'],(.025,.033,.042),(.10,.12,.125),180,.18)
 textured(g['navy'],(.018,.029,.041),(.055,.075,.09),70,.06)
 concrete=mat('Concrete / aggregate',(.32,.32,.28));textured(concrete,(.20,.22,.20),(.43,.44,.4),130,.16)
 metal=mat('Anodised aluminium',(.12,.17,.21));p=metal.node_tree.nodes.get('Principled BSDF')
 if p:p.inputs['Metallic'].default_value=.75;p.inputs['Roughness'].default_value=.28
 glass=mat('Tinted blue glass',(.025,.08,.115));p=next(n for n in glass.node_tree.nodes if n.type=='BSDF_PRINCIPLED');p.inputs['Metallic'].default_value=.65;p.inputs['Roughness'].default_value=.13
 foliage=mat('Pines / olive green',(.045,.10,.055));bark=mat('Bark',(.075,.05,.025))
 warm=mat('Safety amber',(.92,.47,.11));dark=mat('Rubber',(.008,.011,.014))

 print('DETAIL_MATERIALS', flush=True)
 # Broad landscape, flattened only around the fictional industrial site.
 old=sc.objects.get('SITE / ground');old.hide_render=True;old.hide_viewport=True
 def height(x,y):
  k=min(1,max(0,max(abs(x)-112,abs(y+30)-157)/105));k=k*k*(3-2*k)
  return k*(10+10*math.sin(x*.022+y*.009)**2+20*math.sin(y*.013-.6)**2+5*math.sin(x*.042+y*.03))-.035
 verts=[];faces=[];N=151;extent=1000
 for j in range(N):
  y=-extent/2+j*extent/(N-1)
  for i in range(N):
   x=-extent/2+i*extent/(N-1);verts.append((x,y,height(x,y)))
 for j in range(N-1):
  for i in range(N-1):a=j*N+i;faces.append((a,a+1,a+N+1,a+N))
 me=bpy.data.meshes.new('Landscape mesh');me.from_pydata(verts,[],faces);me.materials.append(g['land'])
 terrain=bpy.data.objects.new('LANDSCAPE / rolling terrain',me);sc.collection.objects.link(terrain)
 for f in me.polygons:f.use_smooth=True
 # Aprons anchor the buildings into their surroundings.
 for x,y,w,h,z in g['buildings']:
  box('SITE / concrete apron',(x,y,.025),(w+5,h+5,.08),concrete)
  for xx in [x-w/2,x+w/2]:
   for yy in [y-h/2,y+h/2]:rod('BUILDING / column',(xx,yy,.05),(xx,yy,z),.1,metal)
  # Panel seams, clerestory glazing, doors, vents and roof equipment.
  for xx in range(int(x-w/2)+1,int(x+w/2),2):
   box('BUILDING / wall seam',(xx,y-h/2-.035,z/2),(.035,.045,z-.1),metal)
  for xx in [x-w*.28,x,x+w*.28]:
   box('BUILDING / window frame',(xx,y-h/2-.06,z*.64),(w*.2,.1,.9),metal)
   box('BUILDING / glazing',(xx,y-h/2-.12,z*.64),(w*.2-.1,.045,.78),glass)
  box('BUILDING / loading door',(x,y+h/2+.03,1.35),(3,.08,2.7),metal)
  for zz in [.35,.7,1.05,1.4,1.75,2.1,2.45]:box('BUILDING / door ribs',(x,y+h/2+.085,zz),(2.9,.025,.035),g['white'])
  for dx in [-w*.23,w*.23]:
   box('BUILDING / HVAC',(x+dx,y,z+.65),(1.6,2.3,.9),metal)
   for dy in [-.55,.55]:
    rod('BUILDING / fan casing',(x+dx,y+dy,z+1.1),(x+dx,y+dy,z+1.16),.5,dark)
  for yy in [y-h/2+.25,y+h/2-.25]:line('BUILDING / roof trim',[(x-w/2,yy,z+.35),(x+w/2,yy,z+.35)],.055,metal)
  for dx in [-w/2-.8,w/2+.8]:box('SITE / bollard',(x+dx,y-h/2-1,.45),(.18,.18,.9),warm)
 # The perimeter is a physical fence, not a decorative coverage circle.
 xmin,xmax,ymin,ymax=g['PERIMETER']
 fencepts=[(xmin,ymin,.2),(xmax,ymin,.2),(xmax,ymax,.2),(xmin,ymax,.2),(xmin,ymin,.2)]
 # An amber graphic underlay identifies the boundary only in the final reveal.
 boundary=line('PERIMETER / graphic boundary',fencepts,.1,g['cyan']);visibility(boundary,[(1057,1320)])
 fencewire=mat('Fence steel',(.12,.16,.15))
 for a,b in zip(fencepts,fencepts[1:]):
  a,b=Vector(a),Vector(b);length=(b-a).length;steps=round(length/3)
  for j in range(steps+1):
   p=a.lerp(b,j/steps)
   if abs(p.x)<4 and p.y==ymax:continue
   rod('PERIMETER / fence post',(p.x,p.y,0),(p.x,p.y,2.3),.045,metal)
  for z in [.3,.8,1.3,1.8,2.2]:
   if a.y==b.y==ymax:
    line('PERIMETER / fence rail',[(xmin,ymax,z),(-4,ymax,z)],.014,fencewire);line('PERIMETER / fence rail',[(4,ymax,z),(xmax,ymax,z)],.014,fencewire)
   else:line('PERIMETER / fence rail',[(a.x,a.y,z),(b.x,b.y,z)],.014,fencewire)
 box('PERIMETER / gate pillar',(-4,40,1.5),(.45,.45,3),concrete)
 box('PERIMETER / gate pillar',(4,40,1.5),(.45,.45,3),concrete)
 rod('PERIMETER / raised barrier',(3.8,40,1),(3.8,40,4.7),.08,warm)
 # Service access and subtle verge variation.
 for side in [-1,1]:box('SITE / gravel verge',(side*3.15,-32,-.002),(1.1,206,.035),concrete)
 # Pine prototypes shared among trees: varied scale and location, constant memory.
 trunk=rod('PINE MASTER / trunk',(0,0,0),(0,0,6),.19,bark)
 # Irregular branch clusters replace the blockout cone silhouettes.
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1)
 temp=bpy.context.object;pv=[v.co.copy() for v in temp.data.vertices];pf=[tuple(f.vertices) for f in temp.data.polygons];bpy.data.objects.remove(temp,do_unlink=True)
 tv=[];tf=[]
 for level in range(9):
  z=1.35+level*.65;radius=2.25*(1-level/10)
  for branch in range(6):
   angle=branch*math.tau/6+level*1.73
   for fraction in [.42,.83]:
    cx=math.cos(angle)*radius*fraction;cy=math.sin(angle)*radius*fraction;cz=z+.27*fraction
    k=len(tv);sx=radius*.50;sy=.35+radius*.10;sz=.36+radius*.07
    for v in pv:
     vx=v.x*sx;vy=v.y*sy
     tv.append((cx+vx*math.cos(angle)-vy*math.sin(angle),cy+vx*math.sin(angle)+vy*math.cos(angle),cz+v.z*sz))
    tf.extend(tuple(k+j for j in face) for face in pf)
 tm=bpy.data.meshes.new('Pine branch clusters');tm.from_pydata(tv,[],tf);tm.materials.append(foliage)
 crown=bpy.data.objects.new('PINE MASTER / branches',tm);sc.collection.objects.link(crown)
 for f in tm.polygons:f.use_smooth=True
 masters=[trunk,crown]
 for o in masters:o.hide_render=True;o.hide_viewport=True
 for i in range(360):
  x=rng.uniform(-360,360);y=rng.uniform(-330,330)
  if -103<x<103 and -155<y<92:continue
  scale=rng.uniform(.70,1.85);base=Vector((x,y,height(x,y)));angle=rng.uniform(0,math.tau)
  for m in masters:
   o=bpy.data.objects.new('LANDSCAPE / pine',m.data);sc.collection.objects.link(o);o.location=base+m.location*scale;o.scale=m.scale*scale;o.rotation_euler=m.rotation_euler
   if m==crown:o.rotation_euler.z=angle
 # Ground vegetation is batched into one mesh, keeping the HD render lightweight.
 gv=[];gf=[]
 for i in range(2100):
  x=rng.uniform(-125,125);y=rng.uniform(-145,90)
  if abs(x)<4 or (-54<x<54 and -97<y<41):continue
  z=height(x,y)
  for j in range(3):
   a=rng.uniform(0,math.tau);r=.045;h=rng.uniform(.18,.48);k=len(gv)
   gv.extend([(x-r*math.cos(a),y-r*math.sin(a),z),(x+r*math.cos(a),y+r*math.sin(a),z),(x+.08*math.cos(a),y+.08*math.sin(a),z+h)])
   gf.append((k,k+1,k+2))
 gm=bpy.data.meshes.new('Grass mesh');gm.from_pydata(gv,[],gf);gm.materials.append(foliage)
 go=bpy.data.objects.new('LANDSCAPE / grass verge',gm);sc.collection.objects.link(go)
 # Low rock clusters near the site provide foreground scale.
 rockmat=mat('Rock / limestone',(.23,.235,.20));textured(rockmat,(.12,.13,.105),(.4,.38,.29),6,.3)
 for i in range(100):
  x=rng.uniform(-150,150);y=rng.uniform(-170,110)
  if -57<x<57 and -100<y<45:continue
  bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(x,y,height(x,y)+.15));o=bpy.context.object;o.name='LANDSCAPE / rock';o.scale=(rng.uniform(.3,1.4),rng.uniform(.4,1),rng.uniform(.25,.7));o.data.materials.append(rockmat)
 print('LANDSCAPE_AND_BOUNDARY', flush=True)
 # Camera heads, glass, fasteners, mounting hardware and cable loops.
 for i,(x,y) in enumerate(g['sensor_pos']):
  head=sc.objects[f'CAM {i+1:02} / head'];prefix=f'CAM {i+1:02}'
  for o in [sc.objects[prefix+' / body']]:
   bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.select_set(False)
   b=o.modifiers.new('Weatherproof rounded housing','BEVEL');b.width=.07;b.segments=4;o.modifiers.new('Normals','WEIGHTED_NORMAL')
  obj=rod(prefix+' / lens glass',(0,0,-.712),(0,0,-.727),.185,glass);obj.parent=head
  for zz,r in [(-.53,.255),(-.67,.242)]:
   obj=rod(prefix+' / lens ring',(0,0,zz),(0,0,zz-.025),r,metal);obj.parent=head
  for xx in [-.33,.33]:
   for yy in [-.23,.23]:
    obj=rod(prefix+' / screw',(xx,yy,-.50),(xx,yy,-.52),.024,metal);obj.parent=head
  obj=box(prefix+' / sun hood',(0,.36,-.18),(.97,.07,1.32),metal);obj.parent=head
  obj=sphere(prefix+' / status LED',(.31,-.2,-.515),(.023,.023,.014),g['cyan']);obj.parent=head
  line(prefix+' / cable',[(x+.2,y,2),(x+.32,y+.12,1.4),(x+.25,y+.1,.35)],.023,dark)
  box(prefix+' / concrete footing',(x,y,.035),(1.65,1.45,.07),concrete)
 # Drone: detailed motors and aerodynamic shell, propeller motion blur enabled later.
 drone=g['drone']
 body=sc.objects['DRONE / body'];body.hide_render=True;body.hide_viewport=True
 shell=sphere('DRONE / aerodynamic shell',(0,0,0),(.46,.68,.20),g['white']);shell.parent=drone
 for x in [-.85,.85]:
  for y in [-.7,.7]:
   for z in [.03,.08,.13]:o=rod('DRONE / motor cooling ring',(x,y,z),(x,y,z+.016),.145,metal);o.parent=drone
   for dx in [-.08,.08]:o=rod('DRONE / landing skid',(x*.30+dx,y*.45,-.12),(x*.60+dx,y*.65,-.47),.025,metal);o.parent=drone
   led=sphere('DRONE / navigation light',(x,y,-.03),(.035,.035,.025),g['cyan'] if x<0 else warm);led.parent=drone
 for x in [-.24,.24]:
  for y in [-.35,-.15,.05,.25]:o=box('DRONE / vent',(x,y,.17),(.16,.06,.02),dark);o.parent=drone
 o=rod('DRONE / antenna',(0,-.25,.2),(0,-.35,.55),.014,dark);o.parent=drone
 for root in g['rotors']:
  for o in list(root.children):o.hide_render=True;o.hide_viewport=True
  verts=[];faces=[]
  for side in [-1,1]:
   for j in range(13):
    t=j/12;r=.07+.49*t;w=.022+.058*math.sin(math.pi*t)**.7
    verts.extend([(side*r,-w+.07*t,.014*math.sin(t*math.pi)),(side*r,w+.07*t,-.014*math.sin(t*math.pi))])
   k=(0 if side==-1 else 26)
   for j in range(12):a=k+j*2;faces.append((a,a+1,a+3,a+2))
  me=bpy.data.meshes.new('Airfoil propeller');me.from_pydata(verts,[],faces);me.materials.append(dark)
  o=bpy.data.objects.new('DRONE / swept airfoil',me);sc.collection.objects.link(o);o.parent=root
  for f in me.polygons:f.use_smooth=True
  sol=o.modifiers.new('Blade thickness','SOLIDIFY');sol.thickness=.008

 # A faint swept rotor disk keeps rotation legible at film shutter speed.
 rotor_haze=mat('Rotor / motion haze',(.16,.20,.23),alpha=.13)
 for r in g['rotors']:
  vv=[(0,0,0)]+[(.56*math.cos(i*math.tau/64),.56*math.sin(i*math.tau/64),0) for i in range(64)]
  ff=[(0,i+1,(i+1)%64+1) for i in range(64)]
  dm=bpy.data.meshes.new('Rotor swept disk');dm.from_pydata(vv,[],ff);dm.materials.append(rotor_haze)
  d=bpy.data.objects.new('DRONE / rotor motion disk',dm);sc.collection.objects.link(d);d.parent=drone;d.location=r.location;d.visible_shadow=False

 print('PRODUCT_DETAIL', flush=True)
 # Replace the blockout face with an intentionally stylised, smooth operator.
 skin=mat('Operator / skin',(.38,.22,.15));p=next(n for n in skin.node_tree.nodes if n.type=='BSDF_PRINCIPLED');p.inputs['Roughness'].default_value=.48;p.inputs['Subsurface Weight'].default_value=.08
 cloth=mat('Operator / jacket',(.027,.047,.061));textured(cloth,(.018,.025,.035),(.045,.07,.09),120,.1)
 hair=mat('Operator / hair',(.022,.018,.015))
 for o in list(sc.objects):
  if o.name.startswith('OPERATOR /') and o.type=='MESH':
   o.data.materials.clear();o.data.materials.append(skin if any(k in o.name for k in ['head','hand','nose']) else cloth)
   if any(k in o.name for k in ['head','torso','hand']):
    su=o.modifiers.new('Smooth form','SUBSURF');su.levels=1;su.render_levels=1
  if o.name.startswith(('OPERATOR / eye','OPERATOR / nose')):o.hide_render=True;o.hide_viewport=True
 # Anatomical head, extracted from the CC0 MakeHuman base mesh (only head/neck).
 from pathlib import Path
 vs=[];groups={};group=''
 for ln in (Path(__file__).resolve().parent/'assets'/'makehuman_base.obj').read_text().splitlines():
  if ln.startswith('v '):vs.append(tuple(map(float,ln.split()[1:4])))
  elif ln.startswith('g '):group=ln[2:];groups.setdefault(group,[])
  elif ln.startswith('f '):groups[group].append(tuple(int(i.split('/')[0])-1 for i in ln.split()[1:]))
 def transform(v):return tuple(ip((-v[0]*.24,-.91+(v[2]-.4)*.24,2+(v[1]-7.2)*.24)))
 fs=[f for f in groups['body'] if all(vs[i][1]>5.95 for i in f)]
 ids=sorted(set(i for f in fs for i in f));index={v:i for i,v in enumerate(ids)}
 me=bpy.data.meshes.new('MakeHuman CC0 / head');me.from_pydata([transform(vs[i]) for i in ids],[],[tuple(index[i] for i in f) for f in fs]);me.materials.append(skin)
 o=bpy.data.objects.new('OPERATOR / anatomical head CC0',me);sc.collection.objects.link(o)
 for f in me.polygons:f.use_smooth=True
 su=o.modifiers.new('Portrait subdivision','SUBSURF');su.levels=1;su.render_levels=1
 sc.objects['OPERATOR / head'].hide_render=True
 # A close cropped hair layer follows the actual scalp surface.
 hfs=[f for f in fs if all(vs[i][1]>7.9 or (vs[i][1]>7.43 and vs[i][2]<.65) for i in f)]
 hids=sorted(set(i for f in hfs for i in f));hi={v:i for i,v in enumerate(hids)}
 hm=bpy.data.meshes.new('Cropped scalp');hm.from_pydata([transform((vs[i][0]*1.005,vs[i][1]+.012,vs[i][2])) for i in hids],[],[tuple(hi[i] for i in f) for f in hfs]);hm.materials.append(hair)
 ho=bpy.data.objects.new('OPERATOR / cropped hair',hm);sc.collection.objects.link(ho)
 for f in hm.polygons:f.use_smooth=True
 su=ho.modifiers.new('Hair smoothing','SUBSURF');su.levels=1;su.render_levels=1
 for side in ['l','r']:
  indices=set(i for f in groups['joint-'+side+'-eye'] for i in f)
  center=[sum(vs[i][a] for i in indices)/len(indices) for a in range(3)]
  sphere('OPERATOR / eyeball',transform(center),(.033,.033,.033),g['white'])
  front=center.copy();front[2]+=.137
  sphere('OPERATOR / iris',transform(front),(.012,.003,.012),hair)
 for x in [-.26,.26]:sphere('OPERATOR / headset earcup',ip((x,-.92,2)),(.05,.085,.11),dark)
 line('OPERATOR / headset band',[ip((.27*math.cos(a),-.92,2+.36*math.sin(a))) for a in [i*math.pi/32 for i in range(33)]],.025,metal)
 line('OPERATOR / headset mic',[ip((.27,-.91,1.94)),ip((.25,-.63,1.88)),ip((.10,-.63,1.88))],.012,dark)
 # Sleeves, cuffs and proper fingers remove the mannequin's cylindrical look.
 for x in [-.5,.5]:
  for j in range(4):sphere('OPERATOR / finger',ip((x+(j-1.5)*.037,.07,1.17)),(.022,.085,.027),skin)
 for x in [-.16,.16]:line('OPERATOR / jacket seam',[ip((x,-1.31,1.15)),ip((x,-1.29,1.65))],.006,metal)
 # Keyboard, monitor framing and control-room background.
 for r in range(4):
  for c in range(13):box('PC / key',ip((-.6+c*.063,-.36+r*.066,1.165)),(.052,.048,.017),g['white'] if c==12 else metal)
 for z in [1.0,1.6,2.2,2.8]:line('ROOM / wall panel seam',[ip((-5,2.86,z)),ip((5,2.86,z))],.009,metal)
 for x in [-3,-2]:
  box('ROOM / cabinet',ip((x,2.4,1)),(.65,.7,2),dark)
  for z in [.3,.7,1.1,1.5,1.9]:box('ROOM / equipment rack',ip((x,2.03,z)),(.57,.04,.27),metal)
 # Enclose the control room so screen light models the portrait.
 box('ROOM / ceiling',ip((0,-.5,3.4)),(10,9,.15),g['navy'])
 box('ROOM / back wall',ip((0,-4.5,1.7)),(10,.15,3.4),g['navy'])
 sc.objects['ROOM / softbox'].location=ip((2,-2,2.95))
 sc.objects['ROOM / softbox'].data.energy=210
 # Landscape lighting and softer local portrait lighting.
 sc.world.node_tree.nodes['Background'].inputs[0].default_value=(.28,.40,.57,1)
 sc.world.node_tree.nodes['Background'].inputs[1].default_value=.45
 sky=sc.world.node_tree.nodes.new('ShaderNodeTexSky');sky.sky_type='MULTIPLE_SCATTERING';sky.sun_elevation=.28;sky.sun_rotation=2.4;sky.altitude=150
 sky.air_density=1;sky.aerosol_density=.4
 sc.world.node_tree.links.new(sky.outputs['Color'],sc.world.node_tree.nodes['Background'].inputs[0])
 sc.world.node_tree.nodes['Background'].inputs[1].default_value=.25
 sun=bpy.data.objects['Sunrise'];sun.rotation_euler=(.60,-.68,-.55);sun.data.energy=3;sun.data.color=(1,.82,.60);sun.data.angle=.10
 if hasattr(sun.data,'use_shadow_jitter'):sun.data.use_shadow_jitter=False
 for light in bpy.data.lights:
  if light.type=='AREA':light.color=(.60,.78,1);light.energy*=.55
 # A large, camera-independent fill keeps the graphite product readable.
 d=bpy.data.lights.new('Exterior soft fill','AREA');d.energy=600;d.shape='DISK';d.size=25
 o=bpy.data.objects.new('Exterior soft fill',d);sc.collection.objects.link(o);g['pose'](o,(5,-10,24),(0,10,2))
 # Refined closeups, fixed focus per shot; screen and diagrams stay sharp.
 for sh in g['shots']:
  if sh['start'] in [1,121,289,313,505,865,961]:
   c=sh['camera'];c.data.dof.use_dof=True;c.data.dof.aperture_fstop=5.6
   if sh['start'] in [1,865,961]:c.data.dof.focus_object=drone
   elif sh['start']==505:c.data.dof.focus_object=sc.objects['OPERATOR / head'];c.data.dof.aperture_fstop=4
   else:c.data.dof.focus_distance=(Vector(sh['p'])-Vector(sh['q'])).length
 # Typeface is embedded in the scene; no font installation is required for playback.
 font=bpy.data.fonts.load('C:/Windows/Fonts/bahnschrift.ttf');font.pack()
 for o in sc.objects:
  if o.type=='FONT':o.data.font=font
 # Name the three layout roles in the scene, and make them available to validation.
 g['OUT'].joinpath('deployment.json').write_text(__import__('json').dumps({'boundary':g['PERIMETER'],'roles':{'local':g['sensor_pos'][:3],'perimeter':g['sensor_pos'][3:23],'early_warning':g['sensor_pos'][23:]},'note':'Fictional presentation layout, not measured coverage'},indent=2))

 from shadow_materials import apply_shadow_fix
 apply_shadow_fix()
