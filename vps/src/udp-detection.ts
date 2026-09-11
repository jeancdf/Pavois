export interface RawDetectionPacket {
  cameraId: string;
  frameIndex: number;
  timestamp: number;
  x: number;
  y: number;
  size: number;
  confidence: number;
  // Pose of the emitting camera at this exact frame, plus the intrinsics
  // needed to turn (x, y) into a bearing. Absent on legacy (pre-pose) lines.
  headingDeg?: number;
  elevationDeg?: number;
  rollDeg?: number;
  fovDeg?: number;
  imageWidth?: number;
  imageHeight?: number;
}

/**
 * UDP: raw,<cameraId>,<frame>,<timestamp_us>,<x>,<y>,<area>,<quality>
 *      [,<headingDeg>,<elevationDeg>,<rollDeg>,<fovDeg>,<imageWidth>,<imageHeight>]
 * The pose/intrinsics fields were appended after the original 8, so a legacy
 * 8-field line still parses (the trailing fields are simply absent).
 */
export function parseRawDetectionLine(line: string): RawDetectionPacket | null {
  const parts = line.trim().split(',');
  if (parts[0] !== 'raw' || parts.length < 8) return null;

  const frameIndex = Number(parts[2]);
  const timestamp = Number(parts[3]);
  const x = Number(parts[4]);
  const y = Number(parts[5]);
  const size = Number(parts[6]);
  const confidence = Number(parts[7]);
  if (
    !parts[1] ||
    ![frameIndex, timestamp, x, y, size, confidence].every(Number.isFinite)
  ) {
    return null;
  }

  const packet: RawDetectionPacket = {
    cameraId: parts[1],
    frameIndex,
    timestamp,
    x,
    y,
    size,
    confidence,
  };

  if (parts.length >= 14) {
    const headingDeg = Number(parts[8]);
    const elevationDeg = Number(parts[9]);
    const rollDeg = Number(parts[10]);
    const fovDeg = Number(parts[11]);
    const imageWidth = Number(parts[12]);
    const imageHeight = Number(parts[13]);
    if (
      [
        headingDeg,
        elevationDeg,
        rollDeg,
        fovDeg,
        imageWidth,
        imageHeight,
      ].every(Number.isFinite)
    ) {
      packet.headingDeg = headingDeg;
      packet.elevationDeg = elevationDeg;
      packet.rollDeg = rollDeg;
      packet.fovDeg = fovDeg;
      packet.imageWidth = imageWidth;
      packet.imageHeight = imageHeight;
    }
  }

  return packet;
}
