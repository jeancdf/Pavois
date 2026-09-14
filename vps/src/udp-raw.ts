import { wrapHeadingDeg } from './udp-attitude';

export interface RawDetection {
  type: 'raw_detection';
  cameraId: string;
  frameIndex: number;
  timestamp: number; // ts_us from the packet
  x: number;
  y: number;
  size: number;
  confidence: number;
  headingDeg?: number;
  elevationDeg?: number;
  rollDeg?: number;
  fx?: number;
  fy?: number;
  cx?: number;
  cy?: number;
  fovDeg?: number;
  k1?: number;
  k2?: number;
  p1?: number;
  p2?: number;
  k3?: number;
  railX?: number;
  railY?: number;
  railZ?: number;
  railHeadingDeg?: number;
  railElevationDeg?: number;
  railRollDeg?: number;
}

function allFinite(values: number[]): boolean {
  return values.every(Number.isFinite);
}

/**
 * UDP: raw,<id>,<frame>,<ts_us>,<x>,<y>,<size>,<conf>
 * Optionnel : ,<heading>,<elev>,<roll>,<fx>,<fy>,<cx>,<cy>,<fov>,
 * <k1>,<k2>,<p1>,<p2>,<k3>[,<rail x/y/z/heading/elevation/roll>]
 */
export function parseRawDetectionLine(line: string): RawDetection | null {
  const parts = line.trim().split(',');
  if (parts[0] !== 'raw' || parts.length < 8) return null;

  const cameraId = parts[1];
  const frameIndex = Number(parts[2]);
  const timestamp = Number(parts[3]);
  const x = Number(parts[4]);
  const y = Number(parts[5]);
  const size = Number(parts[6]);
  const confidence = Number(parts[7]);
  if (
    !cameraId ||
    !allFinite([frameIndex, timestamp, x, y, size, confidence])
  ) {
    return null;
  }

  const detection: RawDetection = {
    type: 'raw_detection',
    cameraId,
    frameIndex,
    timestamp,
    x,
    y,
    size,
    confidence,
  };

  // Pose seulement si heading, élévation et roll sont tous finis.
  if (parts.length < 11) return detection;
  const headingDeg = Number(parts[8]);
  const elevationDeg = Number(parts[9]);
  const rollDeg = Number(parts[10]);
  if (!allFinite([headingDeg, elevationDeg, rollDeg])) {
    return detection;
  }
  detection.headingDeg = wrapHeadingDeg(headingDeg);
  detection.elevationDeg = elevationDeg;
  detection.rollDeg = rollDeg;

  // Intrinsèques seulement après une pose complète (5 champs finis).
  if (parts.length < 16) return detection;
  const fx = Number(parts[11]);
  const fy = Number(parts[12]);
  const cx = Number(parts[13]);
  const cy = Number(parts[14]);
  const fovDeg = Number(parts[15]);
  if (allFinite([fx, fy, cx, cy, fovDeg])) {
    detection.fx = fx;
    detection.fy = fy;
    detection.cx = cx;
    detection.cy = cy;
    detection.fovDeg = fovDeg;
  }
  if (parts.length < 21) return detection;
  const distortion = parts.slice(16, 21).map(Number);
  if (allFinite(distortion)) {
    [detection.k1, detection.k2, detection.p1, detection.p2, detection.k3] =
      distortion;
  }
  if (parts.length < 27) return detection;
  const rail = parts.slice(21, 27).map(Number);
  if (allFinite(rail)) {
    [
      detection.railX,
      detection.railY,
      detection.railZ,
      detection.railHeadingDeg,
      detection.railElevationDeg,
      detection.railRollDeg,
    ] = rail;
  }
  return detection;
}
