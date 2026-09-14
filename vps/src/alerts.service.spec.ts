import { AlertsService } from './alerts.service';
import { PrismaService } from './prisma.service';
import { EventsGateway } from './events.gateway';

function fakePrisma() {
  return {
    alert: {
      create: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn(),
    },
  };
}

describe('AlertsService', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let gateway: { broadcast: jest.Mock };
  let service: AlertsService;

  beforeEach(() => {
    prisma = fakePrisma();
    gateway = { broadcast: jest.fn() };
    service = new AlertsService(
      prisma as unknown as PrismaService,
      gateway as unknown as EventsGateway,
    );
  });

  it('fires a "new track" alert the first time a trackId is seen', () => {
    service.onTrackUpdate({ trackId: 'obj1', cameraId: 'jean' });
    expect(gateway.broadcast).toHaveBeenCalledWith('alert', {
      type: 'alert',
      message: 'Nouvelle piste détectée : obj1',
      trackId: 'obj1',
      cameraId: 'jean',
    });
  });

  it('does not repeat the "new track" alert for the same trackId', () => {
    service.onTrackUpdate({ trackId: 'obj1' });
    service.onTrackUpdate({ trackId: 'obj1' });
    expect(gateway.broadcast).toHaveBeenCalledTimes(1);
  });

  it('appends the classification to the "new track" message', () => {
    service.onTrackUpdate({ trackId: 'obj2', classification: 'drone' });
    expect(gateway.broadcast).toHaveBeenNthCalledWith(1, 'alert', {
      type: 'alert',
      message: 'Nouvelle piste détectée : obj2 (DRONE)',
      trackId: 'obj2',
      cameraId: undefined,
    });
  });

  it('fires a one-time DRONE-confirmed alert in addition to the new-track alert', () => {
    service.onTrackUpdate({ trackId: 'obj3', classification: 'drone' });
    expect(gateway.broadcast).toHaveBeenCalledTimes(2);
    expect(gateway.broadcast).toHaveBeenNthCalledWith(2, 'alert', {
      type: 'alert',
      message: 'DRONE confirmé — piste obj3',
      trackId: 'obj3',
      cameraId: undefined,
    });

    // Same track, still drone: new-track alert already fired, drone alert must not repeat.
    service.onTrackUpdate({ trackId: 'obj3', classification: 'drone' });
    expect(gateway.broadcast).toHaveBeenCalledTimes(2);
  });

  it('fires a high-confidence warning at or above the threshold, not below it', () => {
    service.onRawDetection({ cameraId: 'jean', confidence: 0.95 });
    expect(gateway.broadcast).not.toHaveBeenCalled();

    service.onRawDetection({ cameraId: 'jean', confidence: 0.96 });
    expect(gateway.broadcast).toHaveBeenCalledWith('alert', {
      type: 'warning',
      message: 'Haute confiance 96% — jean',
      cameraId: 'jean',
    });
  });

  it('high-confidence detections are not deduplicated (fire every time)', () => {
    service.onRawDetection({ cameraId: 'jean', confidence: 0.99 });
    service.onRawDetection({ cameraId: 'jean', confidence: 0.99 });
    expect(gateway.broadcast).toHaveBeenCalledTimes(2);
  });

  it('persists every fired alert without blocking the broadcast', async () => {
    service.onTrackUpdate({ trackId: 'obj4' });
    // persist() is fire-and-forget; flush microtasks before asserting.
    await Promise.resolve();
    expect(prisma.alert.create).toHaveBeenCalledWith({
      data: {
        type: 'alert',
        message: 'Nouvelle piste détectée : obj4',
        trackId: 'obj4',
        cameraId: null,
      },
    });
  });

  it('does not throw when persistence fails', async () => {
    prisma.alert.create.mockRejectedValueOnce(new Error('down'));
    expect(() => service.onTrackUpdate({ trackId: 'obj5' })).not.toThrow();
    await Promise.resolve();
  });
});
