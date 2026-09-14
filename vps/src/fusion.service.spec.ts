import {
  enuToGps,
  lookAt,
  makeIntrinsics,
  projectWorldToPixel,
  vNorm,
  vSub,
  type Vec3,
} from './fusion-geo';
import { FusionService } from './fusion.service';
import { FusionObservation } from './fusion.types';

const TARGET: Vec3 = { x: 2, y: 30, z: 12 };
const GPS_ORIGIN = { lat: 48.82608, lon: 2.3659, alt: 58.52 };

function observation(
  cameraId: string,
  extra: Partial<FusionObservation> = {},
): FusionObservation {
  return {
    cameraId,
    frameIndex: 0,
    timestampUs: 0,
    x: 100,
    y: 50,
    size: 12,
    confidence: 0.8,
    receivedAtMs: Date.now(),
    ...extra,
  };
}

function posedAt(
  cameraId: string,
  eye: Vec3,
  target: Vec3,
  extra: Partial<FusionObservation> = {},
): FusionObservation {
  const pose = lookAt(eye, target);
  const intr = makeIntrinsics(1280, 720, 70);
  const pix = projectWorldToPixel(intr, pose, target);
  if (!pix) {
    throw new Error(`no projection for ${cameraId}`);
  }
  return observation(cameraId, {
    timestampUs: 1_000_000,
    x: pix[0],
    y: pix[1],
    camX: pose.x,
    camY: pose.y,
    camZ: pose.z,
    headingDeg: pose.headingDeg,
    elevationDeg: pose.elevationDeg,
    rollDeg: pose.rollDeg,
    fx: intr.fx,
    fy: intr.fy,
    cx: intr.cx,
    cy: intr.cy,
    fovDeg: intr.fovDeg,
    imageWidth: intr.imageWidth,
    imageHeight: intr.imageHeight,
    ...extra,
  });
}

function posedObservation(
  cameraId: string,
  eye: Vec3,
  extra: Partial<FusionObservation> = {},
): FusionObservation {
  return posedAt(cameraId, eye, TARGET, extra);
}

const EYES: Record<string, Vec3> = {
  jean: { x: -12, y: -2, z: 2 },
  tanel: { x: 11, y: 1, z: 2 },
  walid: { x: 0, y: -14, z: 3 },
};

function ingestTriplet(
  service: FusionService,
  target: Vec3,
  timestampUs: number,
  receivedAtMs: number,
): void {
  for (const [id, eye] of Object.entries(EYES)) {
    service.ingest(
      posedAt(id, eye, target, {
        timestampUs,
        receivedAtMs,
        lat: GPS_ORIGIN.lat,
        lon: GPS_ORIGIN.lon,
        alt: GPS_ORIGIN.alt,
      }),
    );
  }
}

describe('FusionService', () => {
  let service: FusionService;

  beforeEach(() => {
    service = new FusionService();
  });

  it('tracks detections from jean, tanel and walid', () => {
    const nowMs = Date.now();
    service.ingest(observation('jean', { receivedAtMs: nowMs }));
    service.ingest(observation('tanel', { receivedAtMs: nowMs }));
    service.ingest(observation('walid', { receivedAtMs: nowMs }));

    const snap = service.snapshot(nowMs);
    expect(snap.activeCameras).toBe(3);
    expect(snap.cameraCount).toBe(3);
    expect(snap.tracks).toEqual([]);
  });

  it('reports age ~0 right after ingest', () => {
    const nowMs = Date.now();
    service.ingest(observation('jean', { receivedAtMs: nowMs }));

    const snap = service.snapshot(nowMs);
    expect(snap.cameras).toHaveLength(1);
    expect(snap.cameras[0].ageMs).toBe(0);
    expect(snap.cameras[0].lastReceivedAtMs).toBe(nowMs);
  });

  it('marks a camera inactive after staleAfterMs', () => {
    const nowMs = Date.now();
    service.ingest(observation('jean', { receivedAtMs: nowMs }));
    service.ingest(observation('tanel', { receivedAtMs: nowMs }));
    const { staleAfterMs } = service.snapshot(nowMs);
    service.ingest(observation('walid', { receivedAtMs: nowMs + 100 }));
    expect(service.snapshot(nowMs + 100).activeCameras).toBe(3);

    const staleAt = nowMs + staleAfterMs + 1;
    const staleSnap = service.snapshot(staleAt);
    expect(staleSnap.activeCameras).toBe(1);
    expect(staleSnap.cameras.find((c) => c.cameraId === 'jean')?.active).toBe(
      false,
    );
    expect(staleSnap.cameras.find((c) => c.cameraId === 'walid')?.active).toBe(
      true,
    );
  });

  it('drops old observations and caps history length', () => {
    const nowMs = Date.now();
    expect(service.snapshot(nowMs).historyWindowMs).toBe(2000);

    for (let i = 0; i < 300; i++) {
      service.ingest(
        observation('jean', {
          frameIndex: i,
          timestampUs: i,
          receivedAtMs: nowMs,
        }),
      );
    }
    const capped = service.history('jean');
    expect(capped).toHaveLength(256);
    expect(capped[0].frameIndex).toBe(44);
    expect(capped[capped.length - 1].frameIndex).toBe(299);

    service.ingest(
      observation('jean', {
        frameIndex: 999,
        timestampUs: 10_000_000,
        receivedAtMs: nowMs,
      }),
    );
    const windowed = service.history('jean');
    const minUs = 10_000_000 - 2000 * 1000;
    expect(windowed.every((obs) => obs.timestampUs >= minUs)).toBe(true);
    expect(windowed).toHaveLength(1);
    expect(windowed[0].frameIndex).toBe(999);
  });

  it('ignores an empty cameraId', () => {
    const nowMs = Date.now();
    service.ingest(observation('', { receivedAtMs: nowMs }));
    service.ingest(observation('jean', { receivedAtMs: nowMs }));

    expect(service.snapshot(nowMs).cameraCount).toBe(1);
    expect(service.history('')).toEqual([]);
    expect(service.history('jean')).toHaveLength(1);
  });

  it('lists snapshot cameras sorted by id', () => {
    const nowMs = Date.now();
    service.ingest(observation('walid', { receivedAtMs: nowMs }));
    service.ingest(observation('jean', { receivedAtMs: nowMs }));
    service.ingest(observation('tanel', { receivedAtMs: nowMs }));

    const ids = service.snapshot(nowMs).cameras.map((c) => c.cameraId);
    expect(ids).toEqual(['jean', 'tanel', 'walid']);
  });

  it('fuses jean/tanel/walid onto a nearby 3D point', () => {
    const nowMs = Date.now();
    const extra = { receivedAtMs: nowMs };
    service.ingest(posedObservation('jean', { x: -12, y: -2, z: 2 }, extra));
    service.ingest(posedObservation('tanel', { x: 11, y: 1, z: 2 }, extra));
    service.ingest(posedObservation('walid', { x: 0, y: -14, z: 3 }, extra));

    const snap = service.snapshot(nowMs);
    const fuse = snap.lastFuse;
    expect(fuse?.ok).toBe(true);
    expect(fuse?.point).toBeTruthy();
    const p = fuse!.point!;
    const err = Math.hypot(p.x - TARGET.x, p.y - TARGET.y, p.z - TARGET.z);
    expect(err).toBeLessThan(1);
    expect(snap.rawIntersections).toHaveLength(3);
    expect(
      snap.rawIntersections.every(
        (intersection) => vNorm(vSub(intersection.point, TARGET)) < 1,
      ),
    ).toBe(true);
    expect(snap.tracks).toEqual([]);
  });

  it('keeps every blob from the aligned camera frames for raw voxels', () => {
    const nowMs = Date.now();
    const frame = {
      frameIndex: 44,
      timestampUs: 1_000_000,
      receivedAtMs: nowMs,
    };
    const jean = posedObservation('jean', EYES.jean, frame);
    const tanel = posedObservation('tanel', EYES.tanel, frame);

    service.ingest(jean);
    service.ingest({ ...jean, x: jean.x + 2, size: jean.size + 1 });
    service.ingest(tanel);
    service.ingest({ ...tanel, x: tanel.x - 2, size: tanel.size + 1 });

    const raw = service.snapshot(nowMs).rawIntersections;
    expect(raw).toHaveLength(4);
    expect(
      raw.every(
        (intersection) => intersection.cameras[0] !== intersection.cameras[1],
      ),
    ).toBe(true);
  });

  it('rejects two nearly collinear cameras', () => {
    const nowMs = Date.now();
    const extra = { receivedAtMs: nowMs };
    service.ingest(posedObservation('jean', { x: 0, y: 0, z: 2 }, extra));
    service.ingest(posedObservation('tanel', { x: 0.15, y: 0, z: 2 }, extra));

    const fuse = service.snapshot(nowMs).lastFuse;
    expect(fuse?.ok).toBe(false);
    expect(fuse?.rejectReason).toBe('no subset passed parallax/residual gates');
  });

  it('confirms a track after several fuse windows', () => {
    const nowMs = Date.now();
    let objectId: number | undefined;
    for (let i = 0; i < 6; i++) {
      const target = { x: 2 + i * 0.4, y: 30, z: 12 };
      ingestTriplet(service, target, 1_000_000 + i * 100_000, nowMs);
      const snap = service.snapshot(nowMs);
      if (snap.tracks.length > 0) {
        if (objectId === undefined) {
          objectId = snap.tracks[0].objectId;
        } else {
          expect(snap.tracks[0].objectId).toBe(objectId);
        }
      }
    }
    const snap = service.snapshot(nowMs);
    expect(snap.tracks).toHaveLength(1);
    expect(objectId).toBeDefined();
    expect(snap.tracks[0].objectId).toBe(objectId);
    const p = snap.tracks[0];
    const truth = { x: 2 + 5 * 0.4, y: 30, z: 12 };
    const err = Math.hypot(p.x - truth.x, p.y - truth.y, p.z - truth.z);
    expect(err).toBeLessThan(2);
  });

  it('smooths a noisy trajectory and keeps identity', () => {
    const nowMs = Date.now();
    const fuseErr: number[] = [];
    const trackErr: number[] = [];
    let objectId: number | undefined;
    for (let i = 0; i < 12; i++) {
      const truth = { x: 2 + i * 0.35, y: 30, z: 12 };
      const noisy = {
        x: truth.x + ((i % 3) - 1) * 0.8,
        y: truth.y + ((i % 2) - 0.5) * 0.6,
        z: truth.z,
      };
      ingestTriplet(service, noisy, 1_000_000 + i * 100_000, nowMs);
      const snap = service.snapshot(nowMs);
      if (snap.lastFuse?.ok && snap.lastFuse.point) {
        const q = snap.lastFuse.point;
        fuseErr.push(Math.hypot(q.x - truth.x, q.y - truth.y, q.z - truth.z));
      }
      if (snap.tracks.length > 0) {
        if (objectId === undefined) {
          objectId = snap.tracks[0].objectId;
        } else {
          expect(snap.tracks[0].objectId).toBe(objectId);
        }
        const q = snap.tracks[0];
        trackErr.push(Math.hypot(q.x - truth.x, q.y - truth.y, q.z - truth.z));
      }
    }
    expect(objectId).toBeDefined();
    expect(trackErr.length).toBeGreaterThan(3);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(trackErr)).toBeLessThan(mean(fuseErr) + 0.5);
  });

  it('pulls GPS track_update payloads after confirmation', () => {
    const nowMs = Date.now();
    for (let i = 0; i < 6; i++) {
      const target = { x: 2 + i * 0.4, y: 30, z: 12 };
      ingestTriplet(service, target, 1_000_000 + i * 100_000, nowMs);
    }
    const updates = service.pullTrackUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].type).toBe('track_update');
    expect(updates[0].trackId).toBe('obj1');
    const truth = { x: 2 + 5 * 0.4, y: 30, z: 12 };
    const gps = enuToGps(truth, GPS_ORIGIN);
    expect(updates[0].lat).toBeCloseTo(gps.lat, 4);
    expect(updates[0].lng).toBeCloseTo(gps.lng, 4);
    expect(updates[0].alt).toBeCloseTo(gps.alt, 1);
    expect(updates[0].classification).toBe('other');
    expect(service.pullTrackUpdates()).toEqual([]);
  });

  it('does not emit GPS tracks without an origin', () => {
    const nowMs = Date.now();
    service.ingest(
      posedObservation('jean', EYES.jean, {
        timestampUs: 1_000_000,
        receivedAtMs: nowMs,
      }),
    );
    service.ingest(
      posedObservation('tanel', EYES.tanel, {
        timestampUs: 1_000_000,
        receivedAtMs: nowMs,
      }),
    );
    expect(service.pullTrackUpdates()).toEqual([]);
  });
});
