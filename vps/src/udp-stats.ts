/**
 * UDP: stats,<cameraId>,<detectFps>,<frameIndex>,<ts_us>,
 *            <captureFps>,<droppedFrames>,<detectorMs>,<temperatureC>
 * The last four fields are optional for backward compatibility.
 */

export interface CameraStats {
  type: 'camera_stats';
  cameraId: string;
  fps: number;
  frameIndex: number;
  timestamp: number;
  captureFps?: number;
  droppedFrames?: number;
  detectorMs?: number;
  temperatureC?: number;
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

  const optional = parts.length >= 9
    ? {
        captureFps: Number(parts[5]),
        droppedFrames: Number(parts[6]),
        detectorMs: Number(parts[7]),
        temperatureC: Number(parts[8]),
      }
    : {};
  if (
    parts.length >= 9 &&
    (!allFinite([
      optional.captureFps!,
      optional.droppedFrames!,
      optional.detectorMs!,
      optional.temperatureC!,
    ]) ||
      optional.captureFps! < 0 ||
      optional.droppedFrames! < 0 ||
      optional.detectorMs! < 0)
  ) {
    return null;
  }

  return {
    type: 'camera_stats',
    cameraId,
    fps,
    frameIndex,
    timestamp,
    ...optional,
  };
}
