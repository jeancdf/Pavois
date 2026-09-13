# PAVOIS — Project Plan
> Pixel-to-Voxel Drone Detection System  
> Last updated: March 2026

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Codebase Audit — What We Have](#2-codebase-audit--what-we-have)
3. [Coordinate System](#3-coordinate-system)
4. [Phase 1 — First Optical Test (2 cameras + drone)](#4-phase-1--first-optical-test)
5. [Phase 2 — Map Interface (Angular + Django)](#5-phase-2--map-interface)
6. [Phase 3 — Real-Time Pipeline](#6-phase-3--real-time-pipeline)
7. [Phase 4 — RF Detection ($22 hardware)](#7-phase-4--rf-detection)
8. [Phase 5 — Lattice Integration](#8-phase-5--lattice-integration)
9. [Military-Grade Roadmap](#9-military-grade-roadmap)
10. [Data Models](#10-data-models)
11. [API Routes](#11-api-routes)
12. [Angular Component Architecture](#12-angular-component-architecture)
13. [Standards & Compliance](#13-standards--compliance)
14. [Budget Summary](#14-budget-summary)

---

## 1. Project Overview

**Pavois** is a drone detection system that uses multiple optical cameras to project pixel
motion into a shared 3D voxel grid via ray casting (Digital Differential Analysis). When the
same moving object is seen by two or more cameras, the rays converge on the same voxels,
creating a bright cluster that localizes the drone in 3D space.

The core algorithm is inherited from
[Pixeltovoxelprojector](https://github.com/ConsistentlyInconsistentYT/Pixeltovoxelprojector)
and is being adapted for ground-based drone detection with integration into
[Anduril Lattice](https://www.anduril.com/lattice/).

### Goal Stack

```
Optical cameras
    → Pixel motion detection
        → Ray casting (DDA) into shared voxel grid
            → 3D drone position
                → Kalman track with ID
                    → CoT / Lattice entity
                        → Angular map UI
```

### Tech Stack

| Layer | Technology |
|---|---|
| Detection engine | C++ (ray_voxel.cpp) + Python (pybind11) |
| Backend | Django + Django REST Framework + Django Channels |
| Frontend | Angular 18 + Leaflet.js |
| Database | PostgreSQL |
| Comms | WebSocket (tracks) + REST (config) |
| Output | CoT XML / Anduril Lattice protobuf |

---

## 2. Codebase Audit — What We Have

### Files Inherited from Pixeltovoxelprojector

| File | Purpose | Status for drone detection |
|---|---|---|
| `ray_voxel.cpp` | Core DDA engine — multi-camera motion→voxel | ✅ Solid foundation |
| `process_image.cpp` | pybind11 C++ module, astronomical origin | ⚠️ Reusable DDA + OMP, wrong coord system |
| `spacevoxelviewer.py` | FITS telescope file processor | ❌ Not relevant |
| `voxelmotionviewer.py` | PyVista visualizer for `.bin` output | ✅ Keep for debugging |
| `PixelationDecensorer.py` | Super-resolution tool | ❌ Not relevant |
| `blenderrenderscript.py` | Blender synthetic data generator | ✅ Free ML training dataset |
| `setup.py` | pybind11 build script | ✅ Keep |

### What Already Works

- ✅ Multi-camera ray fusion — cameras grouped by `camera_index`, rays accumulate in one shared grid
- ✅ Frame-diff motion detection — `|prev − curr| > threshold` per pixel
- ✅ Yaw / pitch / roll rotation matrix → world-space ray direction
- ✅ AABB ray-box intersection + DDA voxel walk
- ✅ pybind11 Python bridge with OpenMP parallelism
- ✅ PyVista visualizer reads `.bin` output

### What Is Missing (Ordered by Priority)

| # | Missing feature | Blocks |
|---|---|---|
| 1 | **WGS84 / ENU coordinate frame** | Everything downstream |
| 2 | **Real-time camera frame streaming** | Live detection |
| 3 | **Kalman multi-target track manager** | Track IDs, velocity |
| 4 | **Background subtraction** | False positive rate |
| 5 | **Fixed distance attenuation** | Depth accuracy |
| 6 | **Drone vs. bird classifier** | Classification |
| 7 | **CoT / Lattice output** | C2 integration |
| 8 | **Sparse voxel grid + time decay** | Real-time memory |

### Known Bugs in the Inherited Code

```cpp
// ray_voxel.cpp line 526 — author flagged this as broken
float val = pix_val * 1.f; // attenuation disabled, need to fix
```

The `alpha` attenuation factor exists but is not applied. It needs to scale
as `1/r²` with the apparent angular size of the target at that distance.

---

## 3. Coordinate System

This is the **most critical decision** — everything else depends on it.

### Convention Used

```
X = East   (right)
Y = North  (forward, away from cameras)
Z = Up
```

### Camera Orientation for Ground Tests

With `yaw=0, pitch=90, roll=0`, a camera points along **+Y (North / forward)**.

Derivation:
```
cam_rot = Rz(yaw=0) × Ry(roll=0) × Rx(pitch=90)
Center ray (local) = [0, 0, -focal_len] → normalized [0, 0, -1]
After Rx(90): [0, 1, 0]  ← points along +Y ✓
```

### Camera Placement for the First Test

```
World Z (up)
    |
    |    (drone flies here)
    |    Y = 5–15m
    |
    ●-----------● ──── World X (East)
  Cam0        Cam1
  [0,0,1.5]  [2,0,1.5]
  yaw=0       yaw=0
  pitch=90    pitch=90
```

### GPS to ENU Conversion (required for Lattice)

```python
from pyproj import Transformer

def lla_to_enu(lat, lon, alt, lat0, lon0, alt0):
    """Convert GPS fix to local ENU meters from origin."""
    R = 6371000
    east  = (lon - lon0) * cos(radians(lat0)) * R * pi / 180
    north = (lat - lat0) * R * pi / 180
    up    = alt - alt0
    return east, north, up
```

---

## 4. Phase 1 — First Optical Test

**Goal:** Prove that 2 USB webcams can detect a small drone in 3D using the voxel pipeline.  
**Cost:** $0 (use existing webcams)  
**Timeline:** 1–2 days

### Hardware Setup

```
Required:
  - 2× USB webcams (any webcam, $0 if you have them)
  - 1× laptop / PC with Python 3.10+
  - 1× small drone (DJI Mini or similar)
  - 1× tape measure

Optional but better:
  - 2× tripods or stable mounts
  - Compass app on phone (for measuring yaw)
```

### Physical Setup

```
Top-down view (not to scale):

  [Cam 0]────── 2m ──────[Cam 1]
     ↑                      ↑
     Both pointing North (0°), horizontal (pitch=90°)
     Height: ~1.5m above ground (on tripods)

  Drone flight zone:
  - Distance from cameras: 5–15m
  - Altitude: 1–5m AGL
  - Flight path: left–right across camera FOV
```

**Measurements to record before the test:**

| Parameter | How to measure | Example |
|---|---|---|
| Camera separation | Tape measure (Cam0 to Cam1) | `2.0 m` |
| Camera height | Tape measure (ground to lens) | `1.5 m` |
| Camera yaw | Compass app on phone | `0° (North)` |
| Camera FOV | Camera spec sheet or calibration | `65°` |
| Drone flight distance | Tape measure (cameras to target zone) | `10 m` |

### metadata.json Format (for existing ray_voxel.cpp)

```json
[
  {
    "camera_index": 0,
    "frame_index": 0,
    "camera_position": [0.0, 0.0, 1.5],
    "yaw": 0.0,
    "pitch": 90.0,
    "roll": 0.0,
    "fov_degrees": 65.0,
    "image_file": "cam0_frame_000.jpg"
  },
  {
    "camera_index": 0,
    "frame_index": 1,
    "camera_position": [0.0, 0.0, 1.5],
    "yaw": 0.0,
    "pitch": 90.0,
    "roll": 0.0,
    "fov_degrees": 65.0,
    "image_file": "cam0_frame_001.jpg"
  },
  {
    "camera_index": 1,
    "frame_index": 0,
    "camera_position": [2.0, 0.0, 1.5],
    "yaw": 0.0,
    "pitch": 90.0,
    "roll": 0.0,
    "fov_degrees": 65.0,
    "image_file": "cam1_frame_000.jpg"
  }
]
```

### Voxel Grid Parameters for Close-Range Test

```cpp
// In ray_voxel.cpp, change these values:
const int N = 80;
const float voxel_size = 0.4f;          // 0.4m per voxel
Vec3 grid_center = {1.0f, 10.0f, 2.0f}; // between cameras, 10m forward, 2m up
// Result: 32m × 32m × 32m volume
```

### Files to Create (Phase 1)

```
pixeltovoxelprojector/tests/
├── capture.py        ← captures frames from 2 webcams, writes metadata.json
├── detect.py         ← pure Python DDA pipeline (no C++ compile needed)
└── SETUP.md          ← physical measurement instructions
```

### What to Look For in the Output

Run `voxelmotionviewer.py` after detection. You should see:

- **Bright voxel cluster** where the drone was — this is where both cameras' rays
  intersected on the same moving object
- **Scattered dim voxels** from background noise — these will be spread across
  the whole grid, not concentrated
- The cluster should move frame-to-frame as the drone moves

### Baseline / Range Ratio (Quality Metric)

```
ratio = camera_separation / target_distance
ratio = 2m / 10m = 0.2   ← GOOD (above 0.15)
ratio = 1m / 20m = 0.05  ← BAD (depth resolution very poor)
```

Anything above 0.15 gives usable depth resolution. Anything below 0.08 is too
poor to localize in 3D — you would know the drone is *there* but not how far.

---

## 5. Phase 2 — Map Interface

**Goal:** Angular + Django UI to configure camera positions, see FOV cones on a map,
and visualize detected drone tracks.  
**Cost:** $0 (all free libraries)  
**Timeline:** 1–2 weeks

### UI Layout

```
┌────────────────────────────────────────────────────────────┐
│  TOPBAR: Pavois.Map  |  STATUS DOT  |  Mode indicator      │
├──────────────┬─────────────────────────────┬───────────────┤
│              │                             │               │
│  LEFT        │       MAP (Leaflet)         │  RIGHT        │
│  SIDEBAR     │                             │  PANEL        │
│              │  [Camera FOV cones]         │               │
│  Camera 0 ▼  │  [Overlap zone]             │  Legend       │
│  Camera 1 ▼  │  [Voxel grid boundary]      │  Components   │
│              │  [Live drone tracks]        │  API routes   │
│  Voxel Grid  │                             │  Data model   │
│  Config      │                             │               │
│              │                             │               │
│  Coverage    │                             │               │
│  Stats       │                             │               │
├──────────────┴─────────────────────────────┴───────────────┤
│  BOTTOM: Active tracks count | Detection FPS | System health│
└────────────────────────────────────────────────────────────┘
```

### Map Layers (Leaflet)

| Layer | Color | Description |
|---|---|---|
| Camera 0 FOV cone | Blue `#58a6ff` | Sector polygon from camera to max range |
| Camera 1 FOV cone | Green `#3fb950` | Same for camera 1 |
| Triangulation overlap | Purple semi-transparent | Intersection of both cones |
| Voxel grid boundary | Orange dashed | 2D projection of 3D grid |
| Live drone tracks | Red/Orange dots | Confirmed track positions |
| Track trails | Fading line | Last N positions of each track |

### FOV Cone Drawing (the key math)

```typescript
// angular/src/app/services/coverage.service.ts

buildFovPolygon(
  lat: number, lon: number,
  yawDeg: number, fovDeg: number,
  rangeM: number
): L.LatLng[] {
  const points: L.LatLng[] = [[lat, lon]];
  const R = 6371000;
  const halfFov = fovDeg / 2;

  for (let i = 0; i <= 40; i++) {
    const bearingDeg = yawDeg - halfFov + (fovDeg * i / 40);
    const bearingRad = bearingDeg * Math.PI / 180;
    const latRad = lat * Math.PI / 180;

    const dLat = (rangeM * Math.cos(bearingRad)) / R;
    const dLon = (rangeM * Math.sin(bearingRad)) / (R * Math.cos(latRad));

    points.push([
      lat + dLat * 180 / Math.PI,
      lon + dLon * 180 / Math.PI
    ]);
  }
  return points;
}
```

### Coverage Quality Metrics (computed live)

```
Baseline / Range ratio  → > 0.15 = good depth resolution
Overlap area            → should fully contain the voxel grid footprint
Grid center in overlap  → must be true for the test to work
```

---

## 6. Phase 3 — Real-Time Pipeline

**Goal:** Replace offline file processing with live camera streams.  
**Cost:** $0  
**Timeline:** 2–3 weeks

### Frame Ingestion (replace file loop)

```python
# Current (batch, offline):
for fits_file in os.listdir('frames/'):
    process_image(fits_file, ...)

# Target (real-time):
import cv2
import threading
from collections import deque

class CameraStream:
    def __init__(self, cam_id: int, source: int | str):
        self.cam_id = cam_id
        self.buffer: deque = deque(maxlen=5)  # lock-free ring buffer
        self._cap = cv2.VideoCapture(source)
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()

    def _read_loop(self):
        while True:
            ok, frame = self._cap.read()
            if ok:
                self.buffer.append(frame)

    def latest(self) -> np.ndarray | None:
        return self.buffer[-1] if self.buffer else None
```

### Kalman Multi-Target Tracker

```python
# pip install filterpy  ← free library

from filterpy.kalman import KalmanFilter
import numpy as np

def make_drone_kalman() -> KalmanFilter:
    """6-state Kalman filter: [x, y, z, vx, vy, vz]"""
    kf = KalmanFilter(dim_x=6, dim_z=3)
    dt = 0.1  # 10 fps
    kf.F = np.array([          # state transition
        [1,0,0,dt,0, 0],
        [0,1,0,0, dt,0],
        [0,0,1,0, 0, dt],
        [0,0,0,1, 0, 0],
        [0,0,0,0, 1, 0],
        [0,0,0,0, 0, 1],
    ])
    kf.H = np.eye(3, 6)        # measurement: position only
    kf.R *= 2.0                # measurement noise
    kf.Q[-1,-1] *= 0.01        # process noise
    return kf
```

### Track Lifecycle

```
voxel cluster detected
    → NEW candidate (age = 1)
        → age < 3: don't emit (noise filter)
        → age >= 3: CONFIRMED track → emit CoT
            → no detection for 5s: STALE flag
                → no detection for 10s: DELETE event
```

### Sparse Voxel Grid + Time Decay

```python
# Replace dense 500³ array with sparse dict + exponential decay

from collections import defaultdict

voxel_grid: dict[tuple, float] = defaultdict(float)
DECAY = 0.85  # per frame decay factor

def update_grid(new_hits: dict[tuple, float]):
    # Decay existing cells
    for key in list(voxel_grid.keys()):
        voxel_grid[key] *= DECAY
        if voxel_grid[key] < 0.01:
            del voxel_grid[key]  # evict dead cells
    # Add new hits
    for key, val in new_hits.items():
        voxel_grid[key] += val
```

---

## 7. Phase 4 — RF Detection

**Goal:** Add a second independent detection modality.  
**Cost:** $22 (RTL-SDR v3 dongle from Amazon)  
**Timeline:** 1–2 days after hardware arrives

### What the RTL-SDR Detects

| Drone brand | Frequency | Protocol |
|---|---|---|
| DJI (most models) | 2.4 GHz / 5.8 GHz | OcuSync, O3 |
| FPV racing drones | 5.8 GHz video | Analog / digital |
| Generic WiFi drones | 2.4 GHz | WiFi 802.11 |
| DJI Aeroscope | 2.4 GHz beacon | Proprietary |

### Implementation

```python
# pip install pyrtlsdr  ← free

from rtlsdr import RtlSdr
import numpy as np

class RfDroneDetector:
    DRONE_BANDS = [2.4e9, 5.8e9]   # Hz
    NOISE_FLOOR_DB = -85.0
    DETECTION_THRESHOLD_DB = 15.0  # dB above noise floor

    def __init__(self):
        self.sdr = RtlSdr()
        self.sdr.sample_rate = 2.048e6
        self.sdr.gain = 'auto'

    def scan_band(self, center_freq: float) -> bool:
        self.sdr.center_freq = center_freq
        samples = self.sdr.read_samples(256 * 1024)
        psd = 10 * np.log10(np.abs(np.fft.fft(samples))**2)
        peak_db = np.max(psd)
        return peak_db > (self.NOISE_FLOOR_DB + self.DETECTION_THRESHOLD_DB)

    def detect(self) -> bool:
        return any(self.scan_band(f) for f in self.DRONE_BANDS)
```

### Fusion with Optical Tracks

```
Optical voxel cluster detected → optical_confidence = 0.6
RF signal detected             → rf_confidence = 0.7

Combined (Bayesian):
  P(drone) = 1 - (1 - 0.6) × (1 - 0.7) = 0.88

Threshold: emit CoT if P(drone) > 0.75
```

---

## 8. Phase 5 — Lattice Integration

**Goal:** Push confirmed tracks to Anduril Lattice and display on Angular map.  
**Cost:** $0  
**Timeline:** 1 week

### CoT Track Message Format

```xml
<event version="2.0"
       type="a-u-A-M-F-Q"
       uid="pavois-track-{track_id}"
       time="{utc_iso}"
       stale="{utc_iso + 5s}"
       how="m-g">
  <point lat="{lat:.6f}"
         lon="{lon:.6f}"
         hae="{alt_m:.1f}"
         ce="12.0"
         le="8.0"/>
  <detail>
    <track speed="{speed_ms:.1f}" course="{heading_deg:.1f}"/>
    <sensor source="pavois-voxel"
            confidence="{confidence:.2f}"
            cameras="{n_cameras}"
            altitude_agl="{alt_agl:.1f}"/>
  </detail>
</event>
```

CoT type codes used:
- `a-u-A-M-F-Q` — unknown unmanned aerial (default until classified)
- `a-f-A-M-F-Q` — friendly (confirmed Remote ID match)
- `a-h-A-M-F-Q` — hostile (no Remote ID, inside restricted zone)

### Django WebSocket Track Publisher

```python
# channels/consumers.py

class TrackConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.channel_layer.group_add('tracks', self.channel_name)
        await self.accept()

    async def track_update(self, event):
        await self.send(text_data=json.dumps(event['track']))
```

### Angular Track Subscription

```typescript
// services/track.service.ts

export class TrackService {
  private ws = new WebSocket('ws://localhost:8000/ws/tracks/');
  tracks$ = new Subject<DroneTrack>();

  constructor() {
    this.ws.onmessage = ({ data }) =>
      this.tracks$.next(JSON.parse(data) as DroneTrack);
  }
}
```

---

## 9. Military-Grade Roadmap

> These are future phases. Not required for the first test.

### Sensor Stack (ordered by cost/impact)

| Sensor | Cost | What it adds |
|---|---|---|
| RTL-SDR dongle | $22 | RF drone control-link detection |
| Acoustic mic array | $30–60 | Passive rotor harmonic detection |
| FLIR Boson 640 | $300–800 | Thermal / night detection |
| FMCW radar module | $100–500 | Range, velocity, micro-Doppler |

### Drone vs. Bird Classification

```
YOLOv8 visual classifier
  → train on Blender synthetic renders (FREE — 3000 camera angles already exist)
  → run on motion crop at < 15ms/frame on GPU

IMM Kalman trajectory model
  → hover / constant-velocity / coordinated-turn models
  → biological vs. controlled trajectories diverge in 3–5 seconds

Acoustic rotor harmonic match
  → FFT of beamformed mic output
  → match against drone signature database
```

### Detection Performance Targets

| Metric | Target |
|---|---|
| Probability of detection (Pd) | ≥ 0.95 at 1km |
| False alarm rate (Pfa) | ≤ 10⁻⁴ per hour |
| Track latency (first detect → CoT) | ≤ 2 seconds |
| Position accuracy (CEP) | ≤ 10m at 1km |
| Simultaneous tracks | ≥ 50 (swarm detection) |

### Security Hardening

```
FIPS 140-2 AES-256-GCM    → all track data encrypted at rest and in transit
TLS 1.3 mutual auth       → sensor nodes authenticate to fusion engine
HSM-signed CoT tracks     → injected/spoofed tracks rejected
STIG / SELinux baseline   → DoD-hardened Linux OS
GPS anti-spoofing         → cross-validate with visual-inertial odometry
```

### Standards to Target

| Standard | Description |
|---|---|
| STANAG 4586 | UAS interoperability |
| STANAG 4607 | GMTI ground moving target format |
| MIL-STD-2525D | Military map symbology |
| CoT / ATAK | Tactical data exchange |
| ASTM F3411-22 | FAA Remote ID parser (IFF) |
| FIPS 140-2/3 | Cryptographic module validation |

---

## 10. Data Models

### Django (PostgreSQL)

```python
# models.py

class CameraConfig(models.Model):
    name          = models.CharField(max_length=50)
    lat           = models.FloatField()
    lon           = models.FloatField()
    alt_m         = models.FloatField(default=1.5)
    yaw_deg       = models.FloatField(default=0.0)
    pitch_deg     = models.FloatField(default=90.0)
    roll_deg      = models.FloatField(default=0.0)
    fov_h_deg     = models.FloatField(default=65.0)
    fov_v_deg     = models.FloatField(default=50.0)
    max_range_m   = models.FloatField(default=30.0)
    stream_source = models.CharField(max_length=200, default='0')
    created_at    = models.DateTimeField(auto_now_add=True)

class VoxelGridConfig(models.Model):
    center_lat    = models.FloatField()
    center_lon    = models.FloatField()
    center_alt_m  = models.FloatField(default=2.0)
    N             = models.IntegerField(default=80)
    voxel_size_m  = models.FloatField(default=0.4)
    decay_factor  = models.FloatField(default=0.85)

class DroneTrack(models.Model):
    track_id      = models.CharField(max_length=50, unique=True)
    lat           = models.FloatField()
    lon           = models.FloatField()
    alt_m         = models.FloatField()
    speed_ms      = models.FloatField()
    heading_deg   = models.FloatField()
    confidence    = models.FloatField()
    sensor_count  = models.IntegerField(default=1)
    status        = models.CharField(
        max_length=20,
        choices=[('active','active'), ('stale','stale'), ('deleted','deleted')],
        default='active'
    )
    first_seen    = models.DateTimeField(auto_now_add=True)
    last_seen     = models.DateTimeField(auto_now=True)

class TrackPosition(models.Model):
    track         = models.ForeignKey(
        DroneTrack, on_delete=models.CASCADE, related_name='positions'
    )
    lat           = models.FloatField()
    lon           = models.FloatField()
    alt_m         = models.FloatField()
    timestamp     = models.DateTimeField(auto_now_add=True)
```

### TypeScript (Angular)

```typescript
// models/camera-config.model.ts
export interface CameraConfig {
  id: string;
  name: string;
  lat: number;
  lon: number;
  alt_m: number;
  yaw_deg: number;
  pitch_deg: number;
  fov_h_deg: number;
  fov_v_deg: number;
  max_range_m: number;
  stream_source: string;
}

// models/voxel-grid.model.ts
export interface VoxelGridConfig {
  center_lat: number;
  center_lon: number;
  center_alt_m: number;
  N: number;
  voxel_size_m: number;
  decay_factor: number;
}

// models/drone-track.model.ts
export interface DroneTrack {
  track_id: string;
  lat: number;
  lon: number;
  alt_m: number;
  speed_ms: number;
  heading_deg: number;
  confidence: number;
  sensor_count: number;
  status: 'active' | 'stale' | 'deleted';
  first_seen: string;
  last_seen: string;
  history?: { lat: number; lon: number; alt_m: number; timestamp: string }[];
}

// models/coverage.model.ts
export interface CoverageMetrics {
  baseline_m: number;
  avg_range_m: number;
  baseline_ratio: number;
  cam0_area_m2: number;
  cam1_area_m2: number;
  overlap_area_m2: number;
  grid_in_overlap: boolean;
}
```

---

## 11. API Routes

### Django REST (Camera + Grid Config)

| Method | URL | Description |
|---|---|---|
| `GET` | `/api/cameras/` | List all camera configs |
| `POST` | `/api/cameras/` | Add a new camera |
| `GET` | `/api/cameras/{id}/` | Get single camera |
| `PUT` | `/api/cameras/{id}/` | Update camera config |
| `DELETE` | `/api/cameras/{id}/` | Remove camera |
| `GET` | `/api/voxel-grid/` | Get current grid config |
| `PUT` | `/api/voxel-grid/` | Update grid config |
| `GET` | `/api/coverage/` | Compute coverage metrics |
| `GET` | `/api/tracks/` | List all active tracks |
| `GET` | `/api/tracks/{id}/` | Get single track with history |

### Django Channels (WebSocket)

| URL | Direction | Description |
|---|---|---|
| `/ws/tracks/` | Server → Client | Live track position updates |
| `/ws/detection-status/` | Server → Client | Detection FPS, voxel stats |
| `/ws/camera-status/` | Server → Client | Per-camera connection health |

### WebSocket Message Format

```json
{
  "type": "track_update",
  "track_id": "pavois-00042",
  "lat": 34.052200,
  "lon": -118.243700,
  "alt_m": 85.4,
  "speed_ms": 8.2,
  "heading_deg": 247.3,
  "confidence": 0.87,
  "status": "active",
  "timestamp": "2026-03-30T14:23:11Z"
}
```

---

## 12. Angular Component Architecture

```
AppComponent
├── TopBarComponent
│   ├── SystemStatusIndicatorComponent
│   └── ModeToggleComponent
│
├── MapComponent  (Leaflet wrapper)
│   ├── CameraMarkerLayerComponent
│   │   └── FovConeLayerComponent        ← draws sector polygons
│   ├── OverlapZoneLayerComponent        ← intersection of FOV cones
│   ├── VoxelGridLayerComponent          ← dashed bounding box
│   └── TrackLayerComponent
│       ├── TrackDotComponent            ← animated dot per track
│       └── TrackTrailComponent          ← fading history line
│
├── LeftPanelComponent
│   ├── CameraListComponent
│   │   └── CameraCardComponent (×N)    ← collapsible config form
│   ├── VoxelGridConfigComponent
│   └── CoverageStatsComponent
│
└── BottomBarComponent
    ├── TrackCountComponent
    ├── DetectionFpsComponent
    └── SystemHealthComponent
```

### Services

```typescript
camera.service.ts     → CRUD for CameraConfig via REST
track.service.ts      → WebSocket subscription for live DroneTrack updates
coverage.service.ts   → FOV cone math, overlap computation, baseline ratio
voxel-grid.service.ts → CRUD for VoxelGridConfig via REST
```

---

## 13. Standards & Compliance

> Target these as the system matures — not required for Phase 1–3.

| Standard | What it covers | Priority |
|---|---|---|
| CoT / ATAK | Tactical track data exchange | Phase 5 |
| STANAG 4586 | UAS interoperability | Phase 5 |
| STANAG 4607 | Ground moving target indicator format | Future |
| MIL-STD-2525D | Military map symbology | Future |
| ASTM F3411-22 | FAA Remote ID (IFF for friendly drones) | Phase 4 |
| FIPS 140-2/3 | Cryptographic module validation | Future |
| NIST SP 800-53 | Security control baseline | Future |
| MIL-STD-810H | Environmental testing | Hardware phase |

---

## 14. Budget Summary

| Phase | What | Cost |
|---|---|---|
| Phase 1 | First optical test (software only) | **$0** |
| Phase 2 | Map interface (Angular + Django) | **$0** |
| Phase 3 | Real-time pipeline (software only) | **$0** |
| Phase 4 | RTL-SDR RF dongle | **$22** |
| Future | FLIR Boson thermal camera | ~$500 |
| Future | FMCW radar module | ~$150 |
| Future | Acoustic mic array (6× MEMS) | ~$40 |
| **Total to working 2-sensor system** | | **$22** |

---

## Immediate Next Steps (in order)

```
[ ] 1. Django: create CameraConfig + VoxelGridConfig models + REST endpoints
[ ] 2. Angular: create MapComponent with Leaflet + FovConeLayerComponent
[ ] 3. Angular: create CameraConfigPanelComponent (sidebar form)
[ ] 4. Angular: wire coverage metrics live from camera inputs
[ ] 5. Physical test: capture frames from 2 webcams, generate metadata.json
[ ] 6. Python: write capture.py + detect.py for the first optical test
[ ] 7. Fix ray_voxel.cpp: change N/voxel_size/grid_center for close-range test
[ ] 8. Run first detection test with a small drone
[ ] 9. Django: add DroneTrack model + WebSocket publisher
[ ] 10. Angular: add TrackLayerComponent + live track display on map
```
