"""Embed the additional caption plates in a standalone Blender compositor."""
import bpy,json
from pathlib import Path
root=Path(__file__).resolve().parent;out=root/'output';s=bpy.context.scene
manifest=json.loads((root/'captions.json').read_text(encoding='utf8'))
nt=bpy.data.node_groups.new('PAVOIS / Légendes V3.1','CompositorNodeTree');s.compositing_node_group=nt
nt.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor')
result=nt.nodes.new('NodeGroupOutput');result.location=(1750,0)
render=nt.nodes.new('CompositorNodeRLayers');render.location=(-300,0)
last=render.outputs['Image']
for i,cue in enumerate(manifest['cues']):
 image=bpy.data.images.load(str(out/'captions'/(cue['id']+'.png')));image.pack()
 im=nt.nodes.new('CompositorNodeImage');im.image=image;im.location=(i*260,-270);im.label=cue['text']
 over=nt.nodes.new('CompositorNodeAlphaOver');over.location=(i*260,0);over.label=f'{cue["start"]}–{cue["end"]} / '+cue['id']
 nt.links.new(last,over.inputs['Background']);nt.links.new(im.outputs['Image'],over.inputs['Foreground'])
 over.inputs['Straight Alpha'].default_value=True
 fac=over.inputs['Factor'];start=cue['start'];end=cue['end'];fade=manifest['fade_frames']
 for f,v in [(1,0),(start,0),(start+fade,1),(end-fade+1,1),(end+1,0)]:
  fac.default_value=v;fac.keyframe_insert('default_value',frame=f)
 last=over.outputs['Image']
nt.links.new(last,result.inputs['Image'])
if nt.animation_data and nt.animation_data.action:
 action=nt.animation_data.action
 for layer in action.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for fc in bag.fcurves:
     for key in fc.keyframe_points:key.interpolation='LINEAR'
text=bpy.data.texts.new('PAVOIS / Légendes et timecodes');text.write(json.dumps(manifest,indent=2,ensure_ascii=False))
s.render.use_compositing=True;s.frame_set(380)
s['caption_manifest']=json.dumps(manifest,ensure_ascii=False)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'pavois_film_v3_legendes.blend'))
# One full-size frame validates the new compositor and all embedded assets.
s.frame_set(226);s.render.filepath=str(out/'captions'/'blender_compositor_check.png');bpy.ops.render.render(write_still=True)
print('CAPTIONS_EMBEDDED',len(manifest['cues']))
