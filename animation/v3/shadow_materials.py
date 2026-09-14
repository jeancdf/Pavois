import bpy

def apply_shadow_fix():
 for m in bpy.data.materials:
  if not m.use_nodes:continue
  if not ('transparent' in m.name or m.name.startswith(('Rotor /','Blue / overlay','Cyan / overlay','Ice / overlay','UI /'))):continue
  nt=m.node_tree
  if nt.nodes.get('Overlay shadow bypass'):continue
  out=next(n for n in nt.nodes if n.type=='OUTPUT_MATERIAL')
  if not out.inputs['Surface'].is_linked:continue
  original=out.inputs['Surface'].links[0].from_socket
  path=nt.nodes.new('ShaderNodeLightPath');path.name='Overlay shadow bypass'
  transparent=nt.nodes.new('ShaderNodeBsdfTransparent');mix=nt.nodes.new('ShaderNodeMixShader')
  nt.links.new(path.outputs['Is Shadow Ray'],mix.inputs[0]);nt.links.new(original,mix.inputs[1]);nt.links.new(transparent.outputs[0],mix.inputs[2]);nt.links.new(mix.outputs[0],out.inputs['Surface'])
  m.use_transparent_shadow=True
 bpy.context.scene.eevee.shadow_pool_size='512'

if __name__=='__main__':
 apply_shadow_fix()
 bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
