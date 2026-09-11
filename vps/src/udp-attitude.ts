export interface ImuCalibration {
  sys: number;
  gyro: number;
  accel: number;
  mag: number;
}

export interface AttitudePacket {
  cameraId: string;
  timestamp: number;
  headingDeg: number;
  elevationDeg: number;
  rollDeg: number;
  /** null quand la Pi ne connaît pas l'état (trame v1 ou `-`). */
  calibration: ImuCalibration | null;
  /** false : lecture IMU ratée, angles = dernière pose connue. */
  valid: boolean;
}

const CALIB_TOKEN = /^[0-3]{4}$/;

export function wrapHeadingDeg(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function headingDeltaDeg(from: number, to: number): number {
  const delta = wrapHeadingDeg(to - from);
  return delta > 180 ? 360 - delta : delta;
}

/**
 * UDP v2: att,<cameraId>,<timestamp_us>,<heading>,<elevation>,<roll>,<calib>,<valid>
 * calib = SGAM (sys, gyro, accel, mag, 0-3) ou `-` ; valid = 1 | 0.
 * La trame v1 à 6 champs reste acceptée (calibration inconnue, valide).
 */
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

  const calibToken = parts[6];
  let calibration: ImuCalibration | null = null;
  if (calibToken !== undefined && calibToken !== '-') {
    if (!CALIB_TOKEN.test(calibToken)) return null;
    const [sys, gyro, accel, mag] = [...calibToken].map(Number);
    calibration = { sys, gyro, accel, mag };
  }

  const validToken = parts[7];
  if (validToken !== undefined && validToken !== '0' && validToken !== '1') {
    return null;
  }

  return {
    cameraId: parts[1],
    timestamp,
    headingDeg: wrapHeadingDeg(headingDeg),
    elevationDeg,
    rollDeg,
    calibration,
    valid: validToken !== '0',
  };
}
