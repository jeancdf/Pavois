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

### Phase 1 + 2: small-target detection & tracking (distant drone)

`small_target_detector.py` + `target_tracker.py` + `realtime_small_target_preview.py`
are the new detection/tracking core (see `documentation/plan-detection-drones.md`).
Unlike the voxel previews below, they do **not** use PyTorch.

- **Phase 1 (detect):** *hunt* for faint, tiny spots (a distant drone) instead
  of deleting small blobs the way `--motion-min-area` does. Three bricks: a slow
  background model, a **multi-scale** top-hat highlighter (bright **and** dark
  targets, any object size), and a sub-pixel centroid.
- **Phase 2 (track):** link detections over time into tracks. A track is only
  **confirmed** once it persists *and* moves coherently — so a flickering wire
  (shimmers in place) and random speckle are filtered out, while a real mover
  becomes a stable marker.

Single camera (no GPU needed):

`python realtime_small_target_preview.py --device 0`

Indoor test with a nearby object moving by more than 40 pixels per frame:

`python realtime_small_target_preview.py --device 0 --backend DSHOW --profile indoor-fast`

The default `--profile distant-target` keeps the original distant aircraft/drone
settings. Explicit options such as `--gate-radius`, `--confirm-hits`,
`--tophat-scales`, or `--gaussian` override the selected profile.
For a very small aircraft on blue sky, use `--profile very-distant-aircraft`.
It computes only the dark 9-pixel top-hat scale, hides the response panel,
tentative tracks and trails, and displays up to twelve confirmed targets. It
accepts one-pixel particles and draws fixed-length direction arrows, independent
of target speed. Its wider association gate handles fast particles, while a
confirmed aircraft marker can coast for 30 missed frames to avoid flicker. When
the aircraft joins its contrail into one elongated component, the detector
tracks only the compact strongest point instead of the trail centroid.
`indoor-fast` uses cheap frame differencing instead of the multi-scale top-hat
and refreshes the response panel every five frames. Tune it with `+` / `-`, or
use `--motion-threshold`, `--motion-min-area`, and `--heatmap-every 0`.

Left pane: live image. **Confirmed** tracks show a solid marker + a velocity
arrow + a trail + id; **tentative** (not-yet-confirmed) tracks show a small grey
dot (hide them with `--no-tentative`). Right pane: the top-hat response heatmap,
to tune the threshold by eye.

Live keys: `q` quit, `+` / `-` sensitivity, `p` cycle polarity
(both/bright/dark), `b` toggle the slow-background brick (turn it **off** for a
handheld / moving camera).

Detector flags: `--polarity {both,bright,dark}`, `--tophat-scales 9,31`
(multi-scale highlighter — keeps the max response over several kernel sizes so
tiny *and* bigger objects pop without tuning; add a bigger scale e.g.
`--tophat-scales 9,31,61` for objects held close to the camera; `--tophat N`
forces a single size), `--thresh-sigma 6` (threshold = median + k·MAD),
`--min-area` / `--max-area` (`--max-area 0` = no upper size limit, the default),
`--no-background`, `--source clip.mp4` (replay a recorded sky video).

Tracker flags: `--confirm-hits 3` / `--confirm-window 5` (M-of-N persistence),
`--min-travel 6` (min displacement to confirm — rejects in-place flicker),
`--gate-radius 30` / `--gate-track 14` (association gates), `--max-coast 8`.

Validate without a camera:

`python realtime_small_target_preview.py --self-test`  → prints
`SMALL_TARGET_SELF_TEST_OK` (detector sub-pixel accuracy + tracker confirms a
mover + rejects noise). The tracker also self-tests on its own:
`python target_tracker.py` → `TRACKER_SELF_TEST_OK`.

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

### Real-time multi-camera preview (DroidCam / phone streams)

`realtime_multi_voxel_preview.py` accepts two or more repeated `--camera`
entries. Each entry needs a video source plus measured pose in the shared world
frame. DroidCam/IP webcam-style URLs can be passed directly to OpenCV:

```powershell
.\.venv\Scripts\python.exe realtime_multi_voxel_preview.py `
  --camera "name=left,source=http://192.168.1.10:4747/video,x=0,y=0,z=1.5,yaw=0,pitch=90,roll=0,fov=60" `
  --camera "name=right,source=http://192.168.1.11:4747/video,x=2,y=0,z=1.5,yaw=0,pitch=90,roll=0,fov=60" `
  --grid-center 1 10 5 --voxel-size 0.35 --grid-n 64 --foreground
```

For a first tripod test, place the phones about 2 m apart, lenses at the same
height, both facing the same direction. Keep `left` at `x=0` and set `right`
to the measured baseline in meters. If DroidCam exposes the phones as Windows
virtual webcams instead of URLs, use `source=0` and `source=1`.

Validation without cameras:

```powershell
.\.venv\Scripts\python.exe realtime_multi_voxel_preview.py --self-test
```
