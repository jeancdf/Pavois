/**
 * UDP: stats,<cameraId>,<fps>,<frameIndex>,<ts_us>
 * Real capture/detect rate from the Pi worker, not the 2 fps preview.
 */

export interface CameraStats {
  type: 'camera_stats';
  cameraId: string;
  fps: number;
  frameIndex: number;
  timestamp: number;
}

function allFinite(values: number[]): boolean {
  return values.every(Number.isFinite);
}

export function parseCameraStatsLine(line: string): CameraStats | null {
  const parts = line.trim().split(',');
  if (parts[0] !== 'stats' || parts.length < 5) return null;

  const cameraId = parts[1];
  const fps = Number(parts[2]);
  const frameIndex = Number(parts[3]);
  const timestamp = Number(parts[4]);
  if (!cameraId || !allFinite([fps, frameIndex, timestamp]) || fps < 0) {
    return null;
  }

  return {
    type: 'camera_stats',
    cameraId,
    fps,
    frameIndex,
    timestamp,
  };
}
