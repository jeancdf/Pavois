"""Run independent frame partitions with bounded GPU and CPU concurrency."""
from pathlib import Path
import subprocess,sys,time
root=Path(__file__).resolve().parent;out=root/'output'
blender='C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
feeds='--feeds' in sys.argv
workers=3
processes=[];logs=[]
for i in range(workers):
 script='render_camera_feeds.py' if feeds else 'render_quality.py'
 args=['--cam',str(i+1)] if feeds else ['--part',str(i),str(workers)]
 log=(out/f'{"feed" if feeds else "render"}_worker_{i}.log').open('w');logs.append(log)
 p=subprocess.Popen([blender,'-b',str(out/'pavois_film_v3.blend'),'-t','4','--python',str(root/script),'--',*args],stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
 processes.append(p)
 print('WORKER',i,'PID',p.pid,flush=True)
while any(p.poll() is None for p in processes):
 time.sleep(15)
 folder=out/('sensor_feeds' if feeds else 'frames_hd')
 print('COMPLETE_IMAGES',len(list(folder.glob('*.png'))),'/',576 if feeds else 1320,flush=True)
codes=[p.returncode for p in processes]
for log in logs:log.close()
if any(codes):raise SystemExit('Renderer failures: '+str(codes))
print('BATCH_COMPLETE',flush=True)
