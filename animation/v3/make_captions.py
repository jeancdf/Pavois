"""Render caption plates and compose them over the original native HD frames."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,subprocess,sys
root=Path(__file__).resolve().parent;out=root/'output';folder=out/'captions';folder.mkdir(exist_ok=True)
manifest=json.loads((root/'captions.json').read_text(encoding='utf8'))
font=ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf',30)
small=ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf',27)
heading=ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf',27)
for cue in manifest['cues']:
 im=Image.new('RGBA',(1920,1080));d=ImageDraw.Draw(im);x,y=cue['x'],cue['y']
 has_heading='heading' in cue
 mainfont=small if has_heading else font
 width=max(d.textlength(cue['text'],font=mainfont),d.textlength(cue.get('heading',''),font=heading))+44
 height=94 if has_heading else 52
 d.rounded_rectangle((x-16,y-9,x+width-16,y+height-9),radius=5,fill=(9,23,31,210))
 d.rounded_rectangle((x-16,y-9,x-12,y+height-9),radius=2,fill=(84,205,218,255))
 if has_heading:
  d.text((x+5,y+3),cue['heading'],font=heading,fill=(114,221,230,255))
  d.text((x+5,y+41),cue['text'],font=mainfont,fill=(232,241,246,255))
 else:d.text((x+5,y+2),cue['text'],font=mainfont,fill=(232,241,246,255))
 im.save(folder/(cue['id']+'.png'))
 # Preview uses precisely the same raster overlay as the final encoded movie.
 frame=(cue['start']+cue['end'])//2
 with Image.open(out/'frames_hd'/f'frame_{frame:04}.png') as bg:
  Image.alpha_composite(bg.convert('RGBA'),im).convert('RGB').save(folder/(cue['id']+'_preview.jpg'),quality=95)
print('CAPTION_PLATES',len(manifest['cues']),flush=True)
if '--plates-only' in sys.argv:raise SystemExit(0)
args=['ffmpeg','-y','-hide_banner','-loglevel','error','-framerate','24','-start_number','1','-i',str(out/'frames_hd'/'frame_%04d.png')]
filters=[];last='0:v'
for i,cue in enumerate(manifest['cues'],1):
 args+=['-loop','1','-framerate','24','-i',str(folder/(cue['id']+'.png'))]
 start=(cue['start']-1)/24;end=(cue['end']-manifest['fade_frames'])/24;duration=manifest['fade_frames']/24
 filters.append(f'[{i}:v]format=rgba,fade=t=in:st={start:.8f}:d={duration:.8f}:alpha=1,fade=t=out:st={end:.8f}:d={duration:.8f}:alpha=1[p{i}]')
 filters.append(f'[{last}][p{i}]overlay=0:0:enable=between(n\,{cue["start"]-1}\,{cue["end"]-1}):format=auto[v{i}]')
 last=f'v{i}'
args+=['-filter_complex_threads','2','-filter_complex',';'.join(filters),'-map',f'[{last}]','-frames:v','1320','-an','-c:v','libx264','-preset','slow','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',str(out/'pavois_film_v3_legendes_1080p.mp4')]
subprocess.run(args,check=True)
print('CAPTIONED_FILM',out/'pavois_film_v3_legendes_1080p.mp4',flush=True)
