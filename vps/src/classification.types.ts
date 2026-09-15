export type TargetLabel = 'drone' | 'human' | 'unknown';

export interface ClassificationVote {
  cameraId: string;
  label: TargetLabel;
  confidence: number;
  reason?: string;
}

export interface TargetClassification {
  type: 'target_classification';
  requestId: string;
  status: 'pending' | 'analyzing' | 'complete';
  label: TargetLabel | null;
  confidence: number;
  cameras: string[];
  receivedCameras: string[];
  votes: ClassificationVote[];
  startedAt: number;
  completedAt: number | null;
}

export interface ClassificationCaptureMeta {
  requestId: string;
  cameraId: string;
  capturedUs: number | null;
  frameId: number | null;
  cx: number | null;
  cy: number | null;
  x0: number | null;
  y0: number | null;
  x1: number | null;
  y1: number | null;
  area: number | null;
}

export interface CaptureTrigger {
  requestId: string;
  cameraIds: string[];
  expiresAt: number;
}
