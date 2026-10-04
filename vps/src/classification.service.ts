import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import type { FusionLastFuse } from './fusion.types';
import { EventsGateway } from './realtime/events.gateway';
import type {
  CaptureTrigger,
  ClassificationCaptureMeta,
  ClassificationReview,
  ClassificationVote,
  TargetClassification,
  TargetLabel,
} from './classification.types';

interface Capture {
  meta: ClassificationCaptureMeta;
  jpeg: Buffer;
}

interface Session {
  trigger: CaptureTrigger;
  captures: Map<string, Capture>;
  timer: ReturnType<typeof setTimeout>;
}

function envPositiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function voteClassifications(votes: ClassificationVote[]): {
  label: TargetLabel;
  confidence: number;
} {
  for (const label of ['human', 'drone'] as const) {
    const matching = votes.filter(
      (vote) => vote.label === label && vote.confidence >= 0.5,
    );
    if (matching.length >= 2) {
      return {
        label,
        confidence:
          matching.reduce((sum, vote) => sum + vote.confidence, 0) /
          matching.length,
      };
    }
  }
  return { label: 'unknown', confidence: 0 };
}

@Injectable()
export class ClassificationService implements OnModuleDestroy {
  private readonly enabled = process.env.CLASSIFICATION_ENABLED !== 'false';
  private readonly cameraIds = (
    process.env.CLASSIFICATION_CAMERA_IDS ?? 'jean,tanel,walid'
  )
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  private readonly nearM = envPositiveNumber('CLASSIFICATION_NEAR_M', 8);
  private readonly resetMs = envPositiveNumber('CLASSIFICATION_RESET_MS', 2000);
  private readonly captureTimeoutMs = envPositiveNumber(
    'CLASSIFICATION_CAPTURE_TIMEOUT_MS',
    3000,
  );
  private readonly pythonTimeoutMs = envPositiveNumber(
    'CLASSIFICATION_PYTHON_TIMEOUT_MS',
    6000,
  );
  private active: Session | null = null;
  private episodeActive = false;
  private lastNearAt = 0;
  private state: TargetClassification | null = null;

  constructor(private readonly events: EventsGateway) {}

  current(): TargetClassification | null {
    return this.state
      ? {
          ...this.state,
          cameras: [...this.state.cameras],
          receivedCameras: [...this.state.receivedCameras],
          votes: this.state.votes.map((vote) => ({
            ...vote,
            boxes: vote.boxes?.map((box) => ({ ...box })),
          })),
        }
      : null;
  }

  considerFusion(
    fuse: FusionLastFuse | null,
    onlineCameraIds: readonly string[],
    now = Date.now(),
  ): CaptureTrigger | null {
    if (!this.enabled || this.cameraIds.length < 3) return null;
    const point = fuse?.ok ? fuse.point : null;
    const near =
      point !== null && Math.hypot(point.x, point.y, point.z) <= this.nearM;
    if (!near) {
      if (this.lastNearAt !== 0 && now - this.lastNearAt > this.resetMs) {
        this.episodeActive = false;
      }
      return null;
    }
    if (this.lastNearAt !== 0 && now - this.lastNearAt > this.resetMs) {
      this.episodeActive = false;
    }
    this.lastNearAt = now;
    if (this.episodeActive || this.active) return null;
    const online = new Set(onlineCameraIds);
    if (!this.cameraIds.every((id) => online.has(id))) return null;

    this.episodeActive = true;
    const trigger: CaptureTrigger = {
      requestId: randomUUID(),
      cameraIds: [...this.cameraIds],
      expiresAt: now + this.captureTimeoutMs,
    };
    const timer = setTimeout(
      () => this.finishUnknown(trigger.requestId),
      this.captureTimeoutMs + 100,
    );
    this.active = { trigger, captures: new Map(), timer };
    this.state = {
      type: 'target_classification',
      requestId: trigger.requestId,
      status: 'pending',
      label: null,
      confidence: 0,
      cameras: [...trigger.cameraIds],
      receivedCameras: [],
      votes: [],
      startedAt: now,
      completedAt: null,
    };
    this.broadcast();
    return trigger;
  }

  ingestCapture(meta: ClassificationCaptureMeta, jpeg: Buffer): boolean {
    const session = this.active;
    if (
      !session ||
      meta.requestId !== session.trigger.requestId ||
      Date.now() > session.trigger.expiresAt + 500 ||
      !session.trigger.cameraIds.includes(meta.cameraId) ||
      session.captures.has(meta.cameraId) ||
      jpeg.length < 8 ||
      jpeg.length > 1024 * 1024 ||
      jpeg[0] !== 0xff ||
      jpeg[1] !== 0xd8
    ) {
      return false;
    }
    session.captures.set(meta.cameraId, { meta, jpeg: Buffer.from(jpeg) });
    if (this.state) {
      this.state.receivedCameras = [...session.captures.keys()].sort();
      this.broadcast();
    }
    if (session.captures.size === session.trigger.cameraIds.length) {
      clearTimeout(session.timer);
      this.active = null;
      if (this.state) {
        this.state.status = 'analyzing';
        this.broadcast();
      }
      void this.classify(session);
    }
    return true;
  }

  private async classify(session: Session): Promise<void> {
    try {
      const votes = await this.runOpenCv([...session.captures.values()]);
      const result = voteClassifications(votes);
      this.complete(result.label, result.confidence, votes, session);
    } catch (error) {
      console.error('[CLASSIFICATION] OpenCV failed:', error);
      this.complete('unknown', 0, [], session);
    }
  }

  private runOpenCv(captures: Capture[]): Promise<ClassificationVote[]> {
    const python = process.env.CLASSIFIER_PYTHON ?? 'python3';
    const script =
      process.env.CLASSIFIER_SCRIPT ?? '/app/classifier/classify_target.py';
    const input = JSON.stringify({
      views: captures.map(({ meta, jpeg }) => ({
        ...meta,
        jpegBase64: jpeg.toString('base64'),
      })),
    });
    return new Promise((resolve, reject) => {
      const child = spawn(python, [script], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('OpenCV timeout'));
      }, this.pythonTimeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < 128 * 1024) stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < 16 * 1024) stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`classifier exit ${code}: ${stderr.trim()}`));
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as { votes?: ClassificationVote[] };
          resolve(Array.isArray(parsed.votes) ? parsed.votes : []);
        } catch {
          reject(new Error('invalid classifier JSON'));
        }
      });
      child.stdin.end(input);
    });
  }

  private finishUnknown(requestId: string): void {
    if (!this.active || this.active.trigger.requestId !== requestId) return;
    const session = this.active;
    clearTimeout(session.timer);
    this.active = null;
    this.complete('unknown', 0, [], session);
  }

  private complete(
    label: TargetLabel,
    confidence: number,
    votes: ClassificationVote[],
    session: Session,
  ): void {
    if (!this.state) return;
    this.state = {
      ...this.state,
      status: 'complete',
      label,
      confidence,
      votes,
      completedAt: Date.now(),
    };
    console.log(
      `[CLASSIFICATION] ${this.state.requestId} => ${label} (${confidence.toFixed(2)})`,
    );
    this.broadcast();
    this.broadcastReview(session, votes);
  }

  private broadcastReview(session: Session, votes: ClassificationVote[]): void {
    if (session.captures.size === 0) return;
    const review: ClassificationReview = {
      type: 'classification_review',
      requestId: session.trigger.requestId,
      createdAt: Date.now(),
      images: session.trigger.cameraIds.flatMap((cameraId) => {
        const capture = session.captures.get(cameraId);
        if (!capture) return [];
        const vote = votes.find((item) => item.cameraId === cameraId) ?? null;
        return [
          {
            cameraId,
            mime: 'image/jpeg' as const,
            jpegBase64: capture.jpeg.toString('base64'),
            capturedUs: capture.meta.capturedUs,
            frameId: capture.meta.frameId,
            width: vote?.imageWidth ?? 1280,
            height: vote?.imageHeight ?? 720,
            vote,
          },
        ];
      }),
    };
    this.events.broadcast('classification_review', review);
  }

  private broadcast(): void {
    if (this.state)
      this.events.broadcast('target_classification', this.current());
  }

  onModuleDestroy(): void {
    if (this.active) clearTimeout(this.active.timer);
  }
}
