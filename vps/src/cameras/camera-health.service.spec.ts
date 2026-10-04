import { CameraHealthService } from './camera-health.service';
import { CameraState } from '../alert-types';

describe('CameraHealthService', () => {
  let service: CameraHealthService;

  beforeEach(() => {
    service = new CameraHealthService();
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('initializes default cameras in EN_ATTENTE state', () => {
    const statuses = service.getHealthStatuses();
    expect(statuses).toHaveLength(3);
    expect(statuses.every((s) => s.state === CameraState.EN_ATTENTE)).toBe(true);
  });

  it('calculates GREEN global reliability when 3 cameras are OK', () => {
    for (const cam of ['jean', 'tanel', 'walid']) {
      service.noteActivity(cam);
    }
    const globalState = service.getGlobalReliability();
    expect(globalState.reliability).toBe('GREEN');
    expect(globalState.activeCameraCount).toBe(3);
  });

  it('triggers DEGRADED_BLIND when an individual camera experiences a brutal luminance drop', () => {
    service.noteActivity('jean');
    // Normal baseline ingest
    service.ingestStats({
      type: 'camera_stats',
      version: 'v2',
      cameraId: 'jean',
      fps: 30,
      frameIndex: 100,
      timestamp: Date.now(),
      lumMean: 120,
      lumStddev: 25,
      frameDiff: 0.5,
      laplacianVar: 30,
      exposureUs: 10000,
      gainDb: 0,
    });

    // Sudden drop on jean ONLY (individual drop)
    service.ingestStats({
      type: 'camera_stats',
      version: 'v2',
      cameraId: 'jean',
      fps: 30,
      frameIndex: 101,
      timestamp: Date.now(),
      lumMean: 5, // < 50% baseline
      lumStddev: 1,
      frameDiff: 0.01,
      laplacianVar: 2,
      exposureUs: 50000,
      gainDb: 18,
    });

    // Run evaluation
    (service as unknown as { evaluateCameraHealth: () => void }).evaluateCameraHealth();

    const jeanStatus = service.getHealthStatuses().find((s) => s.cameraId === 'jean');
    expect(jeanStatus?.state).toBe(CameraState.DEGRADED_BLIND);
  });

  it('triggers REDUCED_VISIBILITY_NIGHT (NOT fault) when ALL cameras drop together (Cloud / Night)', () => {
    const now = Date.now();
    for (const cam of ['jean', 'tanel', 'walid']) {
      service.noteActivity(cam);
    }
    // Baseline ingest
    for (const cam of ['jean', 'tanel', 'walid']) {
      service.ingestStats({
        type: 'camera_stats',
        version: 'v2',
        cameraId: cam,
        fps: 30,
        frameIndex: 100,
        timestamp: now,
        lumMean: 100,
        lumStddev: 20,
        frameDiff: 0.5,
        laplacianVar: 30,
        exposureUs: 10000,
        gainDb: 0,
      });
    }

    // Collective drop (all 3 together)
    for (const cam of ['jean', 'tanel', 'walid']) {
      service.ingestStats({
        type: 'camera_stats',
        version: 'v2',
        cameraId: cam,
        fps: 30,
        frameIndex: 101,
        timestamp: now + 100,
        lumMean: 10,
        lumStddev: 2,
        frameDiff: 0.1,
        laplacianVar: 5,
        exposureUs: 40000,
        gainDb: 12,
      });
    }

    (service as unknown as { evaluateCameraHealth: () => void }).evaluateCameraHealth();

    const statuses = service.getHealthStatuses();
    expect(
      statuses.every((s) => s.state === CameraState.REDUCED_VISIBILITY_NIGHT),
    ).toBe(true);
  });
});
