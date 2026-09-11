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
}

function allFinite(values: number[]): boolean {
  return values.every(Number.isFinite);
}

/**
 * UDP: raw,<id>,<frame>,<ts_us>,<x>,<y>,<size>,<conf>
 * Optionnel (SCRUM-55) : ,<heading>,<elev>,<roll>[,<fx>,<fy>,<cx>,<cy>,<fov>]
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
  return detection;
}
