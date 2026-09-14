"""Verify every source image and the encoded delivery, independently of Blender."""
from pathlib import Path
from PIL import Image
import subprocess,json,hashlib
out=Path(__file__).resolve().parent/'output'
for f in range(1,1321):
 p=out/'frames_hd'/f'frame_{f:04}.png'
 with Image.open(p) as im:
  assert im.size==(1920,1080),(f,im.size)
  im.verify()
video=out/'pavois_film_v3_1080p.mp4'
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(video)],text=True))
streams=probe['streams'];vs=[s for s in streams if s['codec_type']=='video']
assert len(vs)==1 and all(s['codec_type']!='audio' for s in streams)
v=vs[0]
assert (v['width'],v['height'])==(1920,1080)
assert v['r_frame_rate']=='24/1' and int(v['nb_frames'])==1320
assert abs(float(probe['format']['duration'])-55)<.01
subprocess.run(['ffmpeg','-v','error','-i',str(video),'-f','null','-'],check=True)
report={'video':video.name,'resolution':[1920,1080],'fps':24,'frames':1320,'duration_seconds':55,'audio':False,'all_source_pngs_verified':True,'full_video_decode':'passed','blend_sha256':hashlib.sha256((out/'pavois_film_v3.blend').read_bytes()).hexdigest(),'video_bytes':video.stat().st_size}
(out/'delivery_verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
