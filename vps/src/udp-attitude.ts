export interface ImuCalibration {
  sys: number | null;
  gyro: number | null;
  accel: number | null;
  mag: number | null;
}

export interface AttitudePacket {
  cameraId: string;
  timestamp: number;
  headingDeg: number;
  elevationDeg: number;
  rollDeg: number;
  /** null quand la Pi ne connaît aucun niveau (trame v1 ou `-`). */
  calibration: ImuCalibration | null;
  /** false : lecture IMU ratée, angles = dernière pose connue. */
  valid: boolean;
}

const CALIB_TOKEN = /^[0-3-]{4}$/;

export function wrapHeadingDeg(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function headingDeltaDeg(from: number, to: number): number {
  const delta = wrapHeadingDeg(to - from);
  return delta > 180 ? 360 - delta : delta;
}

/**
 * Jeton SGAM (sys, gyro, accel, mag) : niveaux 0-3, `-` par niveau inconnu,
 * ou `-` seul. null si tout est inconnu, undefined si le jeton est malformé.
 */
export function parseCalibrationToken(
  token: string,
): ImuCalibration | null | undefined {
  if (token === '-') return null;
  if (!CALIB_TOKEN.test(token)) return undefined;
  const [sys, gyro, accel, mag] = [...token].map((ch) =>
    ch === '-' ? null : Number(ch),
  );
  if ([sys, gyro, accel, mag].every((level) => level === null)) return null;
  return { sys, gyro, accel, mag };
}

/**
 * UDP v2: att,<cameraId>,<timestamp_us>,<heading>,<elevation>,<roll>,<calib>,<valid>
 * calib = jeton SGAM (voir parseCalibrationToken) ; valid = 1 | 0.
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

  let calibration: ImuCalibration | null = null;
  if (parts[6] !== undefined) {
    const parsed = parseCalibrationToken(parts[6]);
    if (parsed === undefined) return null;
    calibration = parsed;
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
