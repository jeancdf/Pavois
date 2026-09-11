/** Niveaux de calibration BNO055 (0 = aucune, 3 = complète). */
export interface ImuCalibration {
  sys: number;
  gyro: number;
  accel: number;
  mag: number;
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
