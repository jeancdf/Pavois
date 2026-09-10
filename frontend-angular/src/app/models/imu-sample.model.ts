export interface ImuSample {
  cameraId: string;
  headingDeg: number;
  elevationDeg: number;
  rollDeg: number;
  timestamp: number;
  receivedAt: number;
}
