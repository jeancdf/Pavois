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
          useValue: { ingest: jest.fn() },
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
