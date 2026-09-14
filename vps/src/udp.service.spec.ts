import { Test, TestingModule } from '@nestjs/testing';
import { UdpService, toFusionObservation } from './udp.service';
import { EventsGateway } from './events.gateway';
import { CamerasService } from './cameras.service';
import { FusionService } from './fusion.service';
import { TracksService } from './tracks.service';
import { AlertsService } from './alerts.service';
import * as crypto from 'crypto';

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
          useValue: { onTrackUpdate: jest.fn(), onRawDetection: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<UdpService>(UdpService);
  });

  function createSignedPacket(payloadStr: string, secretKey: string, timestampMsOverride?: number): Buffer {
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

    it('should reject a packet shorter than 40 bytes', () => {
      const shortPacket = Buffer.from('short_data');
      const result = (service as any).verifyUdpPacket(shortPacket, secretKey);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Paquet trop court');
    });

    it('should reject a packet with an invalid HMAC signature', () => {
      const payload = 'raw,cam0,100,12345,10.0,20.0,5.0,0.95';
      const packet = createSignedPacket(payload, secretKey);
      
      // Corrupt the HMAC bytes (index 8 to 39)
      packet[10] ^= 0xff;

      const result = (service as any).verifyUdpPacket(packet, secretKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Signature HMAC invalide');
    });

    it('should reject a replayed packet with a timestamp older than 2000 ms (Anti-Replay)', () => {
      const payload = 'raw,cam0,100,12345,10.0,20.0,5.0,0.95';
      const oldTimestamp = Date.now() - 5000; // 5 seconds ago
      const expiredPacket = createSignedPacket(payload, secretKey, oldTimestamp);

      const result = (service as any).verifyUdpPacket(expiredPacket, secretKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Rejet Anti-Replay');
    });
  });
});

describe('UdpService fused track_update', () => {
  it('broadcasts GPS tracks after ingesting a raw detection', async () => {
    const broadcast = jest.fn();
    const ingest = jest.fn();
    const track = {
      type: 'track_update' as const,
      trackId: 'obj1',
      lat: 48.8264,
      lng: 2.3659,
      alt: 70.5,
      timestamp: 1_000_000,
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UdpService,
        { provide: EventsGateway, useValue: { broadcast } },
        { provide: CamerasService, useValue: { list: () => [], localPose: () => null } },
        {
          provide: FusionService,
          useValue: {
            ingest,
            pullTrackUpdates: () => [track],
            snapshot: () => ({ lastFuse: null, tracks: [] }),
          },
        },
        {
          provide: TracksService,
          useValue: { record: jest.fn() },
        },
        {
          provide: AlertsService,
          useValue: { onTrackUpdate: jest.fn(), onRawDetection: jest.fn() },
        },
      ],
    }).compile();
    const udp = module.get(UdpService);
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
    udp.ingestRawDetection(detection);
    expect(ingest).toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith('raw_detection', detection);
    expect(broadcast).toHaveBeenCalledWith('fuse_update', {
      type: 'fuse_update',
      lastFuse: null,
      tracks: [],
    });
    expect(broadcast).toHaveBeenCalledWith('track_update', track);
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
