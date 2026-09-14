"""Encode the odd-frame Blender preview at 12 fps, preserving 32s duration."""
from pathlib import Path
import shutil
import subprocess

out = Path(__file__).resolve().parent / 'output'
frames = [out / 'animatic_frames' / f'frame_{n:04}.png' for n in range(1, 769, 2)]
missing = [str(p) for p in frames if not p.is_file() or p.stat().st_size == 0]
if missing:
    raise SystemExit('Incomplete preview: ' + ', '.join(missing[:5]))
ffmpeg = shutil.which('ffmpeg')
if not ffmpeg:
    raise SystemExit('ffmpeg must be available on PATH')
with subprocess.Popen([ffmpeg, '-y', '-hide_banner', '-loglevel', 'error',
                       '-f', 'image2pipe', '-framerate', '12', '-vcodec', 'png',
                       '-i', '-', '-an', '-c:v', 'libx264', '-crf', '20',
                       '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                       str(out / 'pavois_animatic.mp4')], stdin=subprocess.PIPE) as process:
    for path in frames:
        process.stdin.write(path.read_bytes())
    process.stdin.close()
    if process.wait():
        raise SystemExit('ffmpeg encoding failed')
print(out / 'pavois_animatic.mp4')
