import { Test, TestingModule } from '@nestjs/testing';
import {
  buildSignedUdpPacket,
  UdpService,
  toFusionObservation,
} from './udp.service';
import { EventsGateway } from './events.gateway';
import { CamerasService } from './cameras.service';
import { FusionService } from './fusion.service';
import { TracksService } from './tracks.service';
import { AlertsService } from './alerts.service';
import * as crypto from 'crypto';
import { ClassificationService } from './classification.service';
import { TuningService } from './tuning.service';
import { routeUdpLine } from './udp-route';
import { CameraHealthService } from './camera-health.service';

const classificationMock = () => ({
  considerFusion: jest.fn().mockReturnValue(null),
});

const tuningMock = () => ({
  broadcastMs: jest.fn().mockReturnValue(50),
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

describe('UdpService HMAC & Anti-Replay Security Unit Tests', () => {
  let service: UdpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UdpService,
        {
          provide: EventsGateway,
          useValue: { broadcast: jest.fn() },
        },
        {
          provide: CamerasService,
          useValue: { setHeadingDeg: jest.fn() },
        },
        {
          provide: FusionService,
          useValue: {
            ingest: jest.fn(),
            pullTrackUpdates: jest.fn().mockReturnValue([]),
            snapshot: jest.fn().mockReturnValue({
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
        { provide: TuningService, useValue: tuningMock() },
        { provide: CameraHealthService, useValue: cameraHealthMock() },
      ],
    }).compile();

    service = module.get<UdpService>(UdpService);
  });

  function createSignedPacket(
    payloadStr: string,
    secretKey: string,
    timestampMsOverride?: number,
  ): Buffer {
    const timestampMs = BigInt(timestampMsOverride ?? Date.now());
    const timestampBuf = Buffer.alloc(8);
    timestampBuf.writeBigInt64BE(timestampMs, 0);

    const payloadBuf = Buffer.from(payloadStr, 'utf-8');

    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(timestampBuf);
    hmac.update(payloadBuf);
    const hmacBuf = hmac.digest();

    return Buffer.concat([timestampBuf, hmacBuf, payloadBuf]);
  }

  describe('verifyUdpPacket HMAC Verification', () => {
    const secretKey = 'my_super_secret_hmac_key_2026';

    it('should validate a correctly signed HMAC-SHA256 packet with fresh timestamp', () => {
      const payload = 'raw,cam0,100,12345,10.0,20.0,5.0,0.95';
      const packet = createSignedPacket(payload, secretKey);

      const result = (service as any).verifyUdpPacket(packet, secretKey);
      expect(result.valid).toBe(true);
      expect(result.payload.toString('utf-8')).toBe(payload);
    });

    it('accepts a capture command signed by the VPS helper', () => {
      const packet = buildSignedUdpPacket(
        'capture,jean,request-1,9999999999999',
        secretKey,
      );
      const result = (service as any).verifyUdpPacket(packet, secretKey);
      expect(result.valid).toBe(true);
      expect(result.payload.toString('utf-8')).toBe(
        'capture,jean,request-1,9999999999999\n',
      );
    });

    it('should reject a packet shorter than 40 bytes', () => {
      const shortPacket = Buffer.from('short_data');
      const result = (service as any).verifyUdpPacket(shortPacket, secretKey);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Paquet trop court');
    });

    it('should reject a packet with an invalid HMAC signature', () => {
      const payload = 'raw,cam0,100,12345,10.0,20.0,5.0,0.95';
      const packet = createSignedPacket(payload, secretKey);

      packet[10] ^= 0xff;

      const result = (service as any).verifyUdpPacket(packet, secretKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Signature HMAC invalide');
    });

    it('should reject a replayed packet with a timestamp older than 2000 ms (Anti-Replay)', () => {
      const payload = 'raw,cam0,100,12345,10.0,20.0,5.0,0.95';
      const oldTimestamp = Date.now() - 5000;
      const expiredPacket = createSignedPacket(
        payload,
        secretKey,
        oldTimestamp,
      );

      const result = (service as any).verifyUdpPacket(expiredPacket, secretKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Rejet Anti-Replay');
    });
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
  const secret = 'tuning-secret';
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
      const verified = (udp as any).verifyUdpPacket(packet, secret);
      return verified.valid ? verified.payload.toString('utf8') : null;
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
});
