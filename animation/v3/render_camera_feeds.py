"""Render actual sensor views for the monitor, in chronological order.
Camera feeds are packed into three animated atlases by pack_camera_feeds.py.
"""
from pathlib import Path
import bpy,time,sys
out=Path(__file__).resolve().parent/'output'/'sensor_feeds';out.mkdir(exist_ok=True)
s=bpy.context.scene;s.render.engine='BLENDER_EEVEE';s.eevee.taa_render_samples=16;s.render.use_motion_blur=False
s.render.resolution_x=240;s.render.resolution_y=135;s.render.resolution_percentage=100
s.render.image_settings.file_format='PNG';s.render.use_persistent_data=True
# Timeline markers otherwise override the selected observation camera.
s.timeline_markers.clear()
indices=[int(sys.argv[sys.argv.index("--cam")+1])-1] if "--cam" in sys.argv else range(3)
started=time.time()
for frame in range(625,817):
 s.frame_set(frame)
 for i in indices:
  path=out/f'cam_{i+1}_{frame:04}.png'
  if path.is_file() and path.stat().st_size:continue
  s.camera=bpy.data.objects[f'CAM {i+1:02} / observation'];s.render.filepath=str(path)
  bpy.ops.render.render(write_still=True)
print('FEEDS_SECONDS',time.time()-started)
