"""Pack 192 actual frames per observation camera into portable texture atlases."""
from pathlib import Path
from PIL import Image
out=Path(__file__).resolve().parent/'output'
for c in range(1,4):
 sheet=Image.new('RGB',(3840,1620))
 for i,frame in enumerate(range(625,817)):
  with Image.open(out/'sensor_feeds'/f'cam_{c}_{frame:04}.png') as im:
   sheet.paste(im.convert('RGB'),(i%16*240,i//16*135))
 sheet.save(out/f'camera_{c}_atlas.png')
 print(out/f'camera_{c}_atlas.png')
