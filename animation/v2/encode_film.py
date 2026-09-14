"""Validate complete rendered sequence and encode the silent 55-second film."""
from pathlib import Path
import subprocess, shutil
out=Path(__file__).resolve().parent/'output'
missing=[f for f in range(1,1321) if not (out/'film_frames'/f'frame_{f:04}.png').is_file() or (out/'film_frames'/f'frame_{f:04}.png').stat().st_size==0]
if missing:raise SystemExit(f'Missing frames: {missing[:10]} ({len(missing)} total)')
ffmpeg=shutil.which('ffmpeg')
if not ffmpeg:raise SystemExit('ffmpeg is required on PATH')
subprocess.run([ffmpeg,'-y','-hide_banner','-loglevel','error','-framerate','24','-start_number','1','-i',str(out/'film_frames'/'frame_%04d.png'),'-frames:v','1320','-an','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(out/'pavois_film_v2.mp4')],check=True)
print(out/'pavois_film_v2.mp4')
