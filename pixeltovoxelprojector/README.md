# Pixeltovoxelprojector

Projects motion of pixels into a shared voxel grid (multi-camera fusion or
single-camera testing).

## Single-camera quick test (Windows)

**Current folder matters.** Paths below are for a shell **inside**
`pixeltovoxelprojector`. If your shell is at the **repo root** (`Pavois`),
prefix files with `pixeltovoxelprojector\` (e.g.
`pip install -r pixeltovoxelprojector\requirements-capture.txt`).

You may have **two** `.venv` folders (`Pavois\.venv` and
`pixeltovoxelprojector\.venv`). CUDA PyTorch must be installed in whichever
venv you activate — check with
`python -c "import torch; print(torch.__version__, torch.cuda.is_available())"`.

### Webcam resolution and noise

Probe which `(width, height)` pairs your camera actually delivers:

`python camera_probe.py`

On Windows, if the default backend errors or warns repeatedly, try DirectShow:

`python camera_probe.py --backend DSHOW`

Then pass the suggested `--width` / `--height` into `capture_single_camera.py`
and `realtime_voxel_preview.py`.

Reduce noise (same flags on both scripts):

- `--gaussian 3` — light blur before motion
- `--bilateral-d 7` — edge-preserving (slower)
- `--temporal 0.35` — blend with previous frame (less flicker)

After denoising you may need a slightly higher motion threshold, e.g.
`--motion 12` on the realtime preview.

Optional venv (from whichever folder you use as project home):

`python -m venv .venv` then `.\.venv\Scripts\Activate.ps1`

1. Install capture deps: `pip install -r requirements-capture.txt`
2. Record frames + metadata:

   `python capture_single_camera.py --out single_cam_run --frames 40`

3. Build and run `ray_voxel` (needs `nlohmann/json`, `stb_image.h` on your
   include path), e.g.:

   `g++ -std=c++17 -O2 ray_voxel.cpp -o ray_voxel`

   `ray_voxel single_cam_run/metadata.json single_cam_run single_cam_run/voxel_grid.bin`

4. Visualize (writes `voxel_grid_meta.json` automatically for alignment):

   `python voxelmotionviewer.py single_cam_run/voxel_grid.bin`

Use `--pitch` / `--grid-center` / `--voxel-size` on the capture script if the
default volume does not intersect your rays (e.g. pointing at the sky from a
window).

### Real-time preview (camera + voxel projections)

Uses **PyTorch**; uses **CUDA** automatically if a GPU build is installed.

`pip install -r requirements-realtime.txt` (or install a **CUDA** `torch` wheel
from [pytorch.org](https://pytorch.org/get-started/locally/) for your GPU).

`python realtime_voxel_preview.py` — left: live feed with motion in red; right:
max-intensity projections (XY, XZ, YZ). Press **q** to quit. Flags match the
capture script (`--pitch`, `--grid-center`, `--no-cuda`, etc.).

If the camera fails with MSMF errors (`can't grab frame`), use
`--backend DSHOW` or leave default `--backend AUTO` (tries MSMF then DSHOW on
Windows).

`realtime_voxel_preview.py` already sends **only moving pixels** into the voxel
scatter (capped by `--max-rays`). `--motion-stride 2` (or 3) samples motion on a
coarser grid for **less GPU work**. `--preview-motion-only` only changes the
left image (static areas black); it does not speed up the pipeline much.

**Lag / ghost trail:** default `--motion-from raw` uses unsmoothed grayscale for
frame differencing so motion lines up with the live image. `--temporal` or
`--motion-from processed` will smear and lag. **Voxel smear on the right:** use
a lower `--decay` (e.g. `0.65`) so the heatmap forgets faster.

**Tongue / flat skin (only edges light up):** plain `|I−I_prev|` is low inside
uniform regions. Try `--foreground` (MOG2 + diff) and/or `--motion-close 1`
(morphological close to connect fragments). Slightly lower `--motion` can help
but adds noise.

**Motion overlay color:** default `--motion-fill white` draws moving pixels as
solid white (no chroma noise from the webcam). Use `--motion-fill red` or
`camera` for the old look.

**Static edges still flashing white:** sensor/compression flicker on sharp lines.
Defaults help: `--motion-diff-median 3` (median on `|diff|` before threshold),
`--motion-open 1` (morph open removes salt / thin junk), `--motion-min-area 32`
(drops tiny blobs). Disable any with `0` for the old sensitive behavior.

**Distant drone (weak diff):** avoid raising `--motion` too high or small movers
vanish. Prefer **`--motion-votes 2`** (or `3`): after thresholding, a pixel
stays on only if enough **3×3 cells** (including itself) also passed the
threshold — removes isolated speckle but **drops a true 1-pixel target**; use
`--motion-votes 0` or `1` if you need single-pixel hits. Combine with
`--motion-open` / `--motion-min-area` before raising `--motion`.

**On-screen HUD:** `realtime_voxel_preview.py` draws a stats panel (frame index,
FPS, motion/candidate ray counts, voxel scatter totals, thresholds, grid, GPU).
Use `--no-hud` to hide it.

**Target ~30 fps (1080p):** defaults were tuned for speed: `--motion-scale 0.5`
(motion on a half-size plane), lower `--ray-steps` / `--max-rays`, voxel panel
refreshed every `--voxel-viz-every 2` frames. For quality over speed:
`--motion-scale 1 --voxel-viz-every 1 --ray-steps 40 --max-rays 3000`.

Legacy metadata remains a **JSON array** of frame objects. Optional wrapped
form: `{ "frames": [...], "voxel_grid": { "N", "voxel_size", "grid_center" } }`.
