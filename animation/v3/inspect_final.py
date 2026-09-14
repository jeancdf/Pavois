"""Review the actual monitor textures and final landscape before the full render."""
import bpy
from pathlib import Path
s=bpy.context.scene;out=Path(__file__).resolve().parent/'output'
s.render.resolution_percentage=50
for f in [765,1320]:
 s.frame_set(f);s.render.filepath=str(out/f'inspect_{f:04}.png');bpy.ops.render.render(write_still=True)
