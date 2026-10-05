import { Test, TestingModule } from '@nestjs/testing';
import {
  buildSignedUdpPacket,
  UdpService,
  toFusionObservation,
} from './udp.service';
import { EventsGateway } from '../realtime/events.gateway';
import { CamerasService } from '../cameras/cameras.service';
import { FusionService } from '../fusion/fusion.service';
import { TracksService } from '../tracks/tracks.service';
import { AlertsService } from '../alerts/alerts.service';
import { ClassificationService } from '../classification/classification.service';
import { TuningService } from '../tuning/tuning.service';
import { routeUdpLine } from './udp-route';
import { CameraHealthService } from '../cameras/camera-health.service';
import { MessageVerifier, signPacket } from '../common/message-auth';

const classificationMock = () => ({
  considerFusion: jest.fn().mockReturnValue(null),
});

const tuningMock = () => ({
  broadcastMs: jest.fn().mockReturnValue(50),
  frameSize: jest.fn().mockReturnValue(null),
  noteReport: jest.fn().mockReturnValue(false),
  pendingCommand: jest.fn().mockReturnValue(null),
  pendingCameraIds: jest.fn().mockReturnValue([]),
  state: jest.fn().mockReturnValue({ type: 'tuning_state' }),
});

const cameraHealthMock = () => ({
  noteActivity: jest.fn(),
  ingestStats: jest.fn(),
  getHealthStatuses: jest.fn().mockReturnValue([]),
  getGlobalReliability: jest.fn().mockReturnValue({
    reliability: 'GREEN',
    activeCameraCount: 3,
    message: 'OK',
  }),
});

describe('UdpService signed packets', () => {
  const secret = 'udp-service-secret-0123456789abc';
  const line = 'raw,jean,100,12345,10.0,20.0,5.0,0.95';
  const from = { address: '10.0.0.7', port: 50123, family: 'IPv4', size: 0 };
  let service: UdpService;
  let dispatch: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UdpService,
        { provide: EventsGateway, useValue: { broadcast: jest.fn() } },
        { provide: CamerasService, useValue: { list: () => [] } },
        { provide: FusionService, useValue: {} },
        { provide: TracksService, useValue: {} },
        { provide: AlertsService, useValue: {} },
        { provide: ClassificationService, useValue: classificationMock() },
        { provide: TuningService, useValue: tuningMock() },
        { provide: CameraHealthService, useValue: cameraHealthMock() },
      ],
    }).compile();

    service = module.get<UdpService>(UdpService);
    (service as any).verifier = new MessageVerifier(secret);
    dispatch = jest
      .spyOn(service as any, 'dispatchRouted')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.UDP_HMAC_SECRET;
  });

  const receive = (packet: Buffer) => (service as any).receive(packet, from);

  it('dispatches a line signed with the shared secret', () => {
    receive(buildSignedUdpPacket(line, secret));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][1]).toBe(line);
  });

  it('drops an unsigned line', () => {
    receive(Buffer.from(`${line}\n`));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('drops a line signed with another secret', () => {
    receive(buildSignedUdpPacket(line, 'another-secret-0123456789abcdefg'));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('drops a packet replayed after capture', () => {
    const packet = buildSignedUdpPacket(line, secret);
    receive(packet);
    receive(packet);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('drops a packet older than 2 s', () => {
    receive(signPacket(Buffer.from(`${line}\n`), secret, Date.now() - 5000));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('refuses to start without a shared secret', () => {
    delete process.env.UDP_HMAC_SECRET;
    expect(() => service.onModuleInit()).toThrow(/UDP_HMAC_SECRET/);
  });

  it('refuses to start with a short secret', () => {
    process.env.UDP_HMAC_SECRET = 'short';
    expect(() => service.onModuleInit()).toThrow(/UDP_HMAC_SECRET/);
  });
});

describe('UdpService fused track_update', () => {
  const track = {
    type: 'track_update' as const,
    trackId: 'obj1',
    lat: 48.8264,
    lng: 2.3659,
    alt: 70.5,
    timestamp: 1_000_000,
  };
  const detection = {
    type: 'raw_detection' as const,
    cameraId: 'jean',
    frameIndex: 1,
    timestamp: 1_000_000,
    x: 10,
    y: 20,
    size: 5,
    confidence: 0.9,
  };

  async function buildService(
    broadcast: jest.Mock,
    ingest: jest.Mock,
    tuning = tuningMock(),
  ) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UdpService,
        { provide: EventsGateway, useValue: { broadcast } },
        {
          provide: CamerasService,
          useValue: {
            list: () => [],
            localPose: () => null,
            updateRailCalibration: () => false,
          },
        },
        {
          provide: FusionService,
          useValue: {
            ingest,
            pullTrackUpdates: () => [track],
            snapshot: () => ({
              lastFuse: null,
              rawIntersections: [],
              tracks: [],
            }),
          },
        },
        {
          provide: TracksService,
          useValue: { record: jest.fn() },
        },
        {
          provide: AlertsService,
          useValue: { processTrackAlert: jest.fn() },
        },
        { provide: ClassificationService, useValue: classificationMock() },
        { provide: TuningService, useValue: tuning },
        { provide: CameraHealthService, useValue: cameraHealthMock() },
      ],
    }).compile();
    return module.get(UdpService);
  }

  it('broadcasts GPS tracks after ingesting a raw detection', async () => {
    const broadcast = jest.fn();
    const ingest = jest.fn();
    const udp = await buildService(broadcast, ingest);
    udp.ingestRawDetection(detection);
    expect(ingest).toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith('raw_detection', detection);
    expect(broadcast).toHaveBeenCalledWith('fuse_update', {
      type: 'fuse_update',
      lastFuse: null,
      rawIntersections: [],
      tracks: [],
    });
    expect(broadcast).toHaveBeenCalledWith('track_update', track);
  });

  it('never sends the deferred fuse_update on top of an immediate one', async () => {
    jest.useFakeTimers();
    try {
      const startMs = 1_800_000_000_000;
      jest.setSystemTime(startMs);
      const broadcast = jest.fn();
      const udp = await buildService(broadcast, jest.fn());
      const fuseUpdates = () =>
        broadcast.mock.calls.filter(([event]) => event === 'fuse_update')
          .length;

      udp.ingestRawDetection(detection);
      expect(fuseUpdates()).toBe(1);
      // Inside the 50 ms window: held back, sent by a timer at +50 ms.
      jest.setSystemTime(startMs + 10);
      udp.ingestRawDetection(detection);
      expect(fuseUpdates()).toBe(1);
      // A detection lands right as the window closes, before the timer runs.
      jest.setSystemTime(startMs + 50);
      udp.ingestRawDetection(detection);
      expect(fuseUpdates()).toBe(2);
      jest.runOnlyPendingTimers();
      expect(fuseUpdates()).toBe(2);
      udp.onModuleDestroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('takes the fuse_update period from the live settings', async () => {
    const broadcast = jest.fn();
    const tuning = tuningMock();
    tuning.broadcastMs.mockReturnValue(0);
    const udp = await buildService(broadcast, jest.fn(), tuning);
    for (let i = 0; i < 3; i++) udp.ingestRawDetection(detection);
    expect(
      broadcast.mock.calls.filter(([event]) => event === 'fuse_update'),
    ).toHaveLength(3);
    udp.onModuleDestroy();
  });
});

describe('UdpService detector settings', () => {
  const secret = 'tuning-secret-0123456789abcdefghij';
  const jean = { address: '10.0.0.7', port: 50123 };

  async function build(tuning = tuningMock()) {
    const broadcast = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UdpService,
        { provide: EventsGateway, useValue: { broadcast } },
        { provide: CamerasService, useValue: { list: () => [] } },
        { provide: FusionService, useValue: {} },
        { provide: TracksService, useValue: {} },
        { provide: AlertsService, useValue: {} },
        { provide: ClassificationService, useValue: classificationMock() },
        { provide: TuningService, useValue: tuning },
        { provide: CameraHealthService, useValue: cameraHealthMock() },
      ],
    }).compile();
    const udp = module.get(UdpService);
    const send = jest.fn();
    // No real socket: the lines are fed straight to the dispatcher.
    (udp as any).server = { send };
    (udp as any).hmacSecret = secret;
    const receive = (line: string, from = jean) =>
      (udp as any).dispatchRouted(routeUdpLine(line), line, from);
    const payloadOf = (packet: Buffer) => {
      const verified = new MessageVerifier(secret).verifyPacket(packet);
      return verified.ok ? verified.payload.toString('utf8') : null;
    };
    return { udp, tuning, broadcast, send, receive, payloadOf };
  }

  it('sends the wanted settings back, signed, to a detector that lags', async () => {
    const { tuning, send, receive, payloadOf } = await build();
    tuning.pendingCommand.mockReturnValue('set,jean,42,diff_threshold=8');
    receive('cfg,jean,1,0,width=640,diff_threshold=14');

    expect(tuning.noteReport).toHaveBeenCalledWith(
      expect.objectContaining({ cameraId: 'jean', version: 0 }),
    );
    expect(tuning.pendingCommand).toHaveBeenCalledWith('jean');
    expect(send).toHaveBeenCalledTimes(1);
    const [packet, port, address] = send.mock.calls[0];
    expect(port).toBe(jean.port);
    expect(address).toBe(jean.address);
    expect(payloadOf(packet)).toBe('set,jean,42,diff_threshold=8\n');
  });

  it('sends nothing to a detector that already runs what is wanted', async () => {
    const { send, receive } = await build();
    receive('cfg,jean,1,42,diff_threshold=8');
    expect(send).not.toHaveBeenCalled();
  });

  it('tells the operators only when the report changed', async () => {
    const { tuning, broadcast, receive } = await build();
    receive('cfg,jean,1,0,diff_threshold=14');
    expect(broadcast).not.toHaveBeenCalledWith(
      'tuning_state',
      expect.anything(),
    );
    tuning.noteReport.mockReturnValue(true);
    receive('cfg,jean,2,42,diff_threshold=8');
    expect(broadcast).toHaveBeenCalledWith('tuning_state', {
      type: 'tuning_state',
    });
  });

  it('pushes to every pending detector it has heard from', async () => {
    const { udp, tuning, send, receive, payloadOf } = await build();
    receive('stats,jean,30,1,1');
    tuning.pendingCameraIds.mockReturnValue(['jean', 'tanel']);
    tuning.pendingCommand.mockImplementation(
      (cameraId: string) => `set,${cameraId},0`,
    );
    udp.pushTuning();
    // tanel has not sent anything yet: no address to send to.
    expect(send).toHaveBeenCalledTimes(1);
    expect(payloadOf(send.mock.calls[0][0])).toBe('set,jean,0\n');
  });
});

describe('toFusionObservation rail pose', () => {
  const detection = {
    type: 'raw_detection' as const,
    cameraId: 'jean',
    frameIndex: 1,
    timestamp: 1_000_000,
    x: 640,
    y: 360,
    size: 20,
    confidence: 0.9,
    headingDeg: 164,
    elevationDeg: 1,
    rollDeg: 2,
  };
  const camera = {
    id: 'jean',
    lat: 48.8,
    lon: 2.3,
    alt: 50,
    headingDeg: 164,
    fovDeg: 65,
    rangeM: 60,
  };

  it('uses metre rail pose and frozen look, not GPS heading', () => {
    const obs = toFusionObservation(detection, camera, 10, {
      id: 'jean',
      x: 0,
      y: 0,
      z: 0,
      headingDeg: 0,
      elevationDeg: 20,
      rollDeg: 0,
    });
    expect(obs.camX).toBe(0);
    expect(obs.camY).toBe(0);
    expect(obs.headingDeg).toBe(0);
    expect(obs.elevationDeg).toBe(20);
    expect(obs.lat).toBe(48.8);
  });

  it('keeps IMU heading when the rail bench is off', () => {
    const obs = toFusionObservation(detection, camera, 10, null);
    expect(obs.camX).toBeUndefined();
    expect(obs.headingDeg).toBe(164);
  });

  it('passes the reported image size along with explicit intrinsics', () => {
    const scaled = { ...detection, fx: 856, fy: 856, cx: 319.75, cy: 179.75 };
    const obs = toFusionObservation(scaled, camera, 10, null, {
      width: 640,
      height: 360,
    });
    expect(obs.imageWidth).toBe(640);
    expect(obs.imageHeight).toBe(360);
  });

  it('leaves the size to the fusion when the intrinsics are derived', () => {
    const obs = toFusionObservation({ ...detection, fx: 0 }, camera, 10, null, {
      width: 640,
      height: 360,
    });
    expect(obs.imageWidth).toBeUndefined();
    expect(obs.imageHeight).toBeUndefined();
  });
});
