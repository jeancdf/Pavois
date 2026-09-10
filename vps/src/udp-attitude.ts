export interface AttitudePacket {
  cameraId: string;
  timestamp: number;
  headingDeg: number;
  elevationDeg: number;
  rollDeg: number;
}

export function wrapHeadingDeg(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function headingDeltaDeg(from: number, to: number): number {
  const delta = wrapHeadingDeg(to - from);
  return delta > 180 ? 360 - delta : delta;
}

/** UDP: att,<cameraId>,<timestamp_us>,<heading>,<elevation>,<roll> */
export function parseAttitudeLine(line: string): AttitudePacket | null {
  const parts = line.trim().split(',');
  if (parts[0] !== 'att' || parts.length < 6) return null;
  const headingDeg = Number(parts[3]);
  const elevationDeg = Number(parts[4]);
  const rollDeg = Number(parts[5]);
  const timestamp = Number(parts[2]);
  if (!parts[1] || ![headingDeg, elevationDeg, rollDeg, timestamp].every(
    Number.isFinite,
  )) {
    return null;
  }
  return {
    cameraId: parts[1],
    timestamp,
    headingDeg: wrapHeadingDeg(headingDeg),
    elevationDeg,
    rollDeg,
  };
}
