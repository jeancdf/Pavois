/**
 * UDP: stats,<cameraId>,<fps>,<frameIndex>,<ts_us> (v1)
 * or stats,v2,<cameraId>,<fps>,<frameIndex>,<ts_us>,<lum_mean>,<lum_stddev>,<frame_diff>,<laplacian_var>,<exposure_us>,<gain_db> (v2)
 */

export interface CameraStats {
  type: 'camera_stats';
  version: 'v1' | 'v2';
  cameraId: string;
  fps: number;
  frameIndex: number;
  timestamp: number;
  lumMean?: number;
  lumStddev?: number;
  frameDiff?: number;
  laplacianVar?: number;
  exposureUs?: number;
  gainDb?: number;
}

function allFinite(values: number[]): boolean {
  return values.every(Number.isFinite);
}

export function parseCameraStatsLine(line: string): CameraStats | null {
  const parts = line.trim().split(',');
  if (parts[0] !== 'stats' || parts.length < 5) return null;

  if (parts[1] === 'v2' && parts.length >= 12) {
    const cameraId = parts[2];
    const fps = Number(parts[3]);
    const frameIndex = Number(parts[4]);
    const timestamp = Number(parts[5]);
    const lumMean = Number(parts[6]);
    const lumStddev = Number(parts[7]);
    const frameDiff = Number(parts[8]);
    const laplacianVar = Number(parts[9]);
    const exposureUs = Number(parts[10]);
    const gainDb = Number(parts[11]);

    if (
      !cameraId ||
      !allFinite([
        fps,
        frameIndex,
        timestamp,
        lumMean,
        lumStddev,
        frameDiff,
        laplacianVar,
        exposureUs,
        gainDb,
      ]) ||
      fps < 0
    ) {
      return null;
    }

    return {
      type: 'camera_stats',
      version: 'v2',
      cameraId,
      fps,
      frameIndex,
      timestamp,
      lumMean,
      lumStddev,
      frameDiff,
      laplacianVar,
      exposureUs,
      gainDb,
    };
  }

  // Legacy v1 format
  const cameraId = parts[1];
  const fps = Number(parts[2]);
  const frameIndex = Number(parts[3]);
  const timestamp = Number(parts[4]);
  if (!cameraId || !allFinite([fps, frameIndex, timestamp]) || fps < 0) {
    return null;
  }

  return {
    type: 'camera_stats',
    version: 'v1',
    cameraId,
    fps,
    frameIndex,
    timestamp,
  };
}
