"""Encode the native 1080p sequence without audio and check all frames exist."""
from pathlib import Path
import subprocess,shutil
out=Path(__file__).resolve().parent/'output'
missing=[f for f in range(1,1321) if not (out/'frames_hd'/f'frame_{f:04}.png').is_file() or not (out/'frames_hd'/f'frame_{f:04}.png').stat().st_size]
if missing:raise SystemExit(f'Missing HD frames: {missing[:10]} / {len(missing)} total')
ffmpeg=shutil.which('ffmpeg')
if not ffmpeg:raise SystemExit('ffmpeg missing from PATH')
subprocess.run([ffmpeg,'-y','-hide_banner','-loglevel','error','-framerate','24','-start_number','1','-i',str(out/'frames_hd'/'frame_%04d.png'),'-frames:v','1320','-an','-c:v','libx264','-preset','slow','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',str(out/'pavois_film_v3_1080p.mp4')],check=True)
print(out/'pavois_film_v3_1080p.mp4')
