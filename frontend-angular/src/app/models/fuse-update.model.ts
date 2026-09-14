export interface FusePoint {
  x: number;
  y: number;
  z: number;
}

export interface FuseLast {
  ok: boolean;
  rejectReason: string | null;
  residualM: number | null;
  parallaxDeg: number | null;
  confidence: number | null;
  cameras: string[];
  point: FusePoint | null;
}

export interface FuseTrack {
  objectId: number;
  timestampUs: number;
  x: number;
  y: number;
  z: number;
  confidence: number;
  cameras: string[];
  classification: string;
}

export interface FuseRayIntersection {
  point: FusePoint;
  residualM: number;
  parallaxDeg: number;
  cameras: [string, string];
  timestampUs: number;
}

export interface FuseUpdate {
  type: 'fuse_update';
  lastFuse: FuseLast | null;
  rawIntersections: FuseRayIntersection[];
  tracks: FuseTrack[];
}
