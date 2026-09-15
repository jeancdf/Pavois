export type TargetLabel = 'drone' | 'human' | 'unknown';

export interface ClassificationBox {
  label: TargetLabel;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClassificationVote {
  cameraId: string;
  label: TargetLabel;
  confidence: number;
  reason?: string;
  imageWidth?: number;
  imageHeight?: number;
  boxes?: ClassificationBox[];
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

export interface ClassificationReviewImage {
  cameraId: string;
  mime: 'image/jpeg';
  jpegBase64: string;
  capturedUs: number | null;
  frameId: number | null;
  width: number;
  height: number;
  vote: ClassificationVote | null;
}

export interface ClassificationReview {
  type: 'classification_review';
  requestId: string;
  createdAt: number;
  images: ClassificationReviewImage[];
}
