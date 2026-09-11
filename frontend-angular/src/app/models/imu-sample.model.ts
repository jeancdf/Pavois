/** Niveaux de calibration (0 = aucune, 3 = complète, null = inconnu). */
export interface ImuCalibration {
  sys: number | null;
  gyro: number | null;
  accel: number | null;
  mag: number | null;
}

export interface ImuSample {
  cameraId: string;
  headingDeg: number;
  elevationDeg: number;
  rollDeg: number;
  /** null quand la Pi ne remonte pas la calibration. */
  calibration: ImuCalibration | null;
  /** false : lecture IMU ratée côté Pi, cap figé sur la dernière pose. */
  valid: boolean;
  timestamp: number;
  receivedAt: number;
}
