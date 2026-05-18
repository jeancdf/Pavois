# Formats de données

Ce fichier décrit les formats utilisés actuellement par PAVOIS et propose des
formats pour l'intégration future.

## Métadonnées d'images

Le pipeline C++ accepte deux formes.

### Format tableau historique

```json
[
  {
    "camera_index": 0,
    "frame_index": 0,
    "camera_position": [0.0, 0.0, 1.5],
    "yaw": 0.0,
    "pitch": 90.0,
    "roll": 0.0,
    "fov_degrees": 60.0,
    "image_file": "frame_0000.jpg"
  }
]
```

### Format enveloppé recommandé

```json
{
  "frames": [
    {
      "camera_index": 0,
      "frame_index": 0,
      "camera_position": [0.0, 0.0, 1.5],
      "yaw": 0.0,
      "pitch": 90.0,
      "roll": 0.0,
      "fov_degrees": 60.0,
      "image_file": "frame_0000.jpg"
    }
  ],
  "voxel_grid": {
    "N": 72,
    "voxel_size": 0.35,
    "grid_center": [0.0, 10.0, 5.0]
  }
}
```

## Champs d'une image

| Champ | Type | Signification |
|---|---:|---|
| `camera_index` | entier | Identifiant numérique pour grouper les images par caméra. |
| `frame_index` | entier | Ordre temporel dans le flux de la caméra. |
| `camera_position` | nombre[3] | Position caméra en mètres dans le repère local. |
| `yaw` | nombre | Rotation autour de Z, en degrés. |
| `pitch` | nombre | Rotation selon la convention actuelle du code, en degrés. |
| `roll` | nombre | Rotation selon la convention actuelle du code, en degrés. |
| `fov_degrees` | nombre | Champ de vision horizontal. |
| `image_file` | chaîne | Nom de fichier relatif au dossier d'images. |

## Métadonnées de grille voxel

| Champ | Type | Signification |
|---|---:|---|
| `N` | entier | Nombre de voxels par axe. |
| `voxel_size` | nombre | Largeur d'un voxel en mètres. |
| `grid_center` | nombre[3] | Centre de la grille dans le repère monde. |

## Fichier binaire voxel

Écrit par `ray_voxel.cpp`.

Disposition :

```text
octets 0..3       int32 N
octets 4..7       float32 voxel_size
reste             float32 voxel_grid[N * N * N]
```

Index linéaire :

```text
idx = i_x * N * N + i_y * N + i_z
```

Un fichier de métadonnées est écrit à côté du binaire en remplaçant `.bin` par
`_meta.json`.

Exemple :

```text
voxel_grid.bin
voxel_grid_meta.json
```

## Caméra simulée frontend

Définie dans `frontend/src/sim/pavoisSim.ts`.

```ts
interface SimCamera {
  id: string
  name: string
  x: number
  y: number
  z: number
  azimuth: number
  fov: number
  range: number
  status: 'active' | 'degraded' | 'offline'
  color: string
}
```

Ces coordonnées sont des unités de simulation, pas directement des mètres ENU.

## Piste simulée frontend

```ts
interface Waypoint {
  x: number
  y: number
  z: number
  t: number
}

interface SimTrack {
  id: string
  name: string
  color: string
  status: 'confirmed' | 'tentative' | 'lost'
  waypoints: Waypoint[]
}
```

## Message futur de mesure

Après extraction de clusters voxel, le détecteur devrait produire des mesures
3D.

```json
{
  "type": "measurement",
  "timestamp": "2026-05-18T12:00:00.000Z",
  "position_enu_m": [4.2, 12.6, 3.1],
  "covariance_m2": [
    [0.25, 0.0, 0.0],
    [0.0, 0.36, 0.0],
    [0.0, 0.0, 0.49]
  ],
  "confidence": 0.72,
  "supporting_cameras": [0, 1],
  "evidence_sum": 1842.5
}
```

## Message futur de piste

L'interface devrait à terme consommer des événements de piste au lieu de données
simulées statiques.

```json
{
  "type": "track_update",
  "track_id": "TRK-001",
  "timestamp": "2026-05-18T12:00:00.000Z",
  "position_enu_m": [4.4, 13.0, 3.2],
  "velocity_mps": [0.6, 1.1, 0.1],
  "confidence": 0.81,
  "status": "confirmed",
  "classification": "unknown_uas",
  "supporting_cameras": ["CAM-01", "CAM-02"]
}
```

## Enregistrement futur de calibration

Un système réel devrait séparer les paramètres intrinsèques et extrinsèques.

```json
{
  "camera_id": "CAM-01",
  "intrinsics": {
    "width_px": 1920,
    "height_px": 1080,
    "fx_px": 1220.0,
    "fy_px": 1215.0,
    "cx_px": 960.0,
    "cy_px": 540.0,
    "distortion": [-0.12, 0.04, 0.0, 0.0, 0.0]
  },
  "extrinsics": {
    "frame": "ENU",
    "position_m": [0.0, 0.0, 1.5],
    "yaw_deg": 0.0,
    "pitch_deg": 90.0,
    "roll_deg": 0.0
  }
}
```

