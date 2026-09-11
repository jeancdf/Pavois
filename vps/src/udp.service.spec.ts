import { Test, TestingModule } from '@nestjs/testing';
import { UdpService } from './udp.service';
import { EventsGateway } from './events.gateway';
import { CamerasService } from './cameras.service';
import { FusionService } from './fusion.service';
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
          useValue: { ingest: jest.fn(), pullTrackUpdates: jest.fn().mockReturnValue([]) },
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
        { provide: CamerasService, useValue: { list: () => [] } },
        {
          provide: FusionService,
          useValue: {
            ingest,
            pullTrackUpdates: () => [track],
          },
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
    expect(broadcast).toHaveBeenCalledWith('track_update', track);
  });
});
