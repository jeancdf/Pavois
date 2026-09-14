"""Install embedded, frame-accurate camera textures in the editable Blender film."""
import bpy
from pathlib import Path
out=Path(__file__).resolve().parent/'output';s=bpy.context.scene
for o in s.objects:
 if o.name.startswith(('UI / projected terrain','UI / drone silhouette')):o.hide_render=True;o.hide_viewport=True
screen=s.objects['PC / screen coordinate system']
for i in range(3):
 root=s.objects[f'UI / projected drone {i}']
 curve=bpy.data.curves.new('Detection bracket','CURVE');curve.dimensions='3D';curve.bevel_depth=.002;curve.bevel_resolution=1
 for pts in [[(-.020,-.018),(-.030,-.018),(-.030,.018),(-.020,.018)],[(.020,-.018),(.030,-.018),(.030,.018),(.020,.018)]]:
  sp=curve.splines.new('POLY');sp.points.add(len(pts)-1)
  for p,(x,y) in zip(sp.points,pts):p.co=(x,y,.04,1)
 obj=bpy.data.objects.new(f'UI / detected drone {i+1}',curve);s.collection.objects.link(obj);obj.parent=root;obj.data.materials.append(bpy.data.materials['Cyan / overlay']);obj.visible_shadow=False
 m=bpy.data.materials.new(f'MONITOR / actual CAM {i+1}');m.use_nodes=True;nt=m.node_tree;nt.nodes.clear()
 outnode=nt.nodes.new('ShaderNodeOutputMaterial');emit=nt.nodes.new('ShaderNodeEmission');emit.inputs[1].default_value=1.15;nt.links.new(emit.outputs[0],outnode.inputs[0])
 tex=nt.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(out/f'camera_{i+1}_atlas.png'));tex.image.pack();tex.interpolation='Linear';tex.extension='EXTEND'
 nt.links.new(tex.outputs['Color'],emit.inputs[0])
 uv=nt.nodes.new('ShaderNodeTexCoord');scale=nt.nodes.new('ShaderNodeVectorMath');scale.operation='MULTIPLY';scale.inputs[1].default_value=(1/16,1/12,1)
 add=nt.nodes.new('ShaderNodeVectorMath');add.operation='ADD';nt.links.new(uv.outputs['UV'],scale.inputs[0]);nt.links.new(scale.outputs[0],add.inputs[0]);nt.links.new(add.outputs[0],tex.inputs['Vector'])
 for f in range(1,1321):
  index=max(0,min(191,f-625));add.inputs[1].default_value=(index%16/16,(11-index//16)/12,0);add.inputs[1].keyframe_insert('default_value',frame=f)
 # Real UVs are explicit; the image is a standard material, without Python handlers.
 cx,cy=.93,.35-i*.39;w,h=.61,.245
 me=bpy.data.meshes.new(f'CAM {i+1} screen quad');me.from_pydata([(cx-w/2,cy-h/2,.044),(cx+w/2,cy-h/2,.044),(cx+w/2,cy+h/2,.044),(cx-w/2,cy+h/2,.044)],[],[(0,1,2,3)])
 layer=me.uv_layers.new();coords=[(0,0),(1,0),(1,1),(0,1)]
 for poly in me.polygons:
  for li in poly.loop_indices:layer.data[li].uv=coords[me.loops[li].vertex_index]
 o=bpy.data.objects.new(f'UI / actual camera feed {i+1}',me);s.collection.objects.link(o);o.parent=screen;o.data.materials.append(m);o.visible_shadow=False
# Keep diagram silhouettes within the map panel and feed labels above the image.
for o in s.objects:
 if o.name.startswith('UI / building'):
  for v in o.data.vertices:
   v.co.x=max(-1.24-o.location.x,min(.48-o.location.x,v.co.x))
   v.co.y=max(-.605-o.location.y,min(.545-o.location.y,v.co.y))
 if o.type=='FONT' and o.name.startswith('UI / CAM 0'):o.location.y+=.03
s.frame_set(380);s.camera=s.objects['06 / Three viewpoints']
s.render.resolution_x=1920;s.render.resolution_y=1080;s.render.resolution_percentage=100;s.eevee.taa_render_samples=64
bpy.ops.wm.save_as_mainfile(filepath=str(out/'pavois_film_v3.blend'))
print('PACKED_CAMERA_FEEDS',3)
