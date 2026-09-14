"""Full-HD, 24fps render with resumable PNG output. --probe measures real cost."""
from pathlib import Path
import bpy,sys,time,json,hashlib
out=Path(__file__).resolve().parent/'output';s=bpy.context.scene
s.render.engine='BLENDER_EEVEE';s.eevee.taa_render_samples=64;s.eevee.shadow_pool_size='512'
s.render.resolution_x=1920;s.render.resolution_y=1080;s.render.resolution_percentage=100
s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGB';s.render.image_settings.color_depth='8';s.render.image_settings.compression=25
s.render.use_persistent_data=True
frames=range(1,1321);folder=out/'frames_hd'
if '--probe' in sys.argv:frames=[60,380,565,1100];folder=out/'quality_probe_final'
if '--part' in sys.argv:
 a=sys.argv.index('--part');part,total=map(int,sys.argv[a+1:a+3]);frames=range(part+1,1321,total)
folder.mkdir(exist_ok=True)
scene_hash=hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest()
signature={'blend_sha256':scene_hash,'resolution':[1920,1080],'samples':64,'fps':24}
info=folder/'render_settings.json'
if info.exists() and json.loads(info.read_text())!=signature:raise RuntimeError('Scene changed: move the previous frame directory before rendering again.')
info.write_text(json.dumps(signature,indent=2))
beg=time.time()
for f in frames:
 path=folder/f'frame_{f:04}.png'
 if path.is_file() and path.stat().st_size:continue
 s.frame_set(f);s.camera=max((m for m in s.timeline_markers if m.frame<=f and m.camera),key=lambda m:m.frame).camera
 s.render.filepath=str(path);t=time.time();bpy.ops.render.render(write_still=True)
 print('FRAME_TIME',f,round(time.time()-t,2),flush=True)
print('TOTAL_SECONDS',round(time.time()-beg,2),flush=True)
