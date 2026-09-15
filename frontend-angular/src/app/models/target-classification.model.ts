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
