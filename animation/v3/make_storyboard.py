"""Build a contact sheet directly from the encoded film's source frames."""
from pathlib import Path
import json
from PIL import Image,ImageDraw,ImageFont
out=Path(__file__).resolve().parent/'output'
edit=json.loads((out/'edit.json').read_text())
w,h=480,310
sheet=Image.new('RGB',(w*3,75+h*((len(edit)+2)//3)), '#121c25')
draw=ImageDraw.Draw(sheet)
fontpath=Path('C:/Windows/Fonts/arial.ttf')
font=ImageFont.truetype(str(fontpath),18) if fontpath.exists() else ImageFont.load_default()
title=ImageFont.truetype(str(fontpath),26) if fontpath.exists() else font
draw.text((20,18),'PAVOIS / FILM V3 / FULL HD / 55 s / 24 fps',font=title,fill='#dcebf5')
for i,shot in enumerate(edit):
 frame=(shot['start']+shot['end'])//2
 path=out/'frames_hd'/f'frame_{frame:04}.png'
 im=Image.open(path).convert('RGB').resize((w,270))
 x=i%3*w;y=75+i//3*h
 sheet.paste(im,(x,y))
 label=f"{(shot['start']-1)/24:05.2f}-{shot['end']/24:05.2f}s  {shot['name']}"
 draw.text((x+10,y+278),label,font=font,fill='#a9cfdd')
sheet.save(out/'storyboard.jpg',quality=92)
print(out/'storyboard.jpg')
