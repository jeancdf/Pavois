"""Render the saved V2 at 24 fps. Resume skips existing nonempty PNGs.
Run in Blender after opening output/pavois_film_v2.blend.
Pass -- --probe for a three-frame timing check.
"""
from pathlib import Path
import bpy, sys, time, json
out=Path(__file__).resolve().parent/'output'
s=bpy.context.scene
p=bpy.context.preferences.addons['cycles'].preferences
try:
 p.compute_device_type='OPTIX';p.get_devices()
 for d in p.devices:d.use=d.type=='OPTIX'
 if any(d.type=='OPTIX' for d in p.devices):s.cycles.device='GPU'
except Exception:pass
s.render.engine='BLENDER_EEVEE';s.eevee.taa_render_samples=16
for m in bpy.data.materials:
 if 'transparent' in m.name:m.surface_render_method='BLENDED'
s.cycles.denoiser='OPTIX'
s.render.use_persistent_data=True
s.render.resolution_x=640;s.render.resolution_y=360;s.render.resolution_percentage=100
s.render.image_settings.file_format='PNG'
frames=range(1,1321)
folder=out/'film_frames';folder.mkdir(exist_ok=True)
if '--probe' in sys.argv:frames=[380,381,382];folder=out/'probe_optix';folder.mkdir(exist_ok=True)
started=time.time()
for f in frames:
 path=folder/f'frame_{f:04}.png'
 if path.is_file() and path.stat().st_size>0:continue
 s.frame_set(f)
 marker=max((m for m in s.timeline_markers if m.frame<=f and m.camera),key=lambda m:m.frame)
 s.camera=marker.camera
 s.render.filepath=str(path);bpy.ops.render.render(write_still=True)
print('RENDER_SECONDS',time.time()-started)
