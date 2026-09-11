import { FusionService } from './fusion.service';
import { FusionObservation } from './fusion.types';

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
});
