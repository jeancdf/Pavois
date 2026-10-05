import { createHmac } from 'crypto';
import {
  MAX_PACKET_BYTES,
  MessageVerifier,
  readSharedSecret,
  signPacket,
  signUpload,
} from './message-auth';

const secret = 'message-auth-secret-0123456789ab';
const now = 1_800_000_000_000;
const line = Buffer.from('raw,jean,1,1000,10,20,5,0.9\n');

describe('readSharedSecret', () => {
  it('refuses a missing secret', () => {
    expect(() => readSharedSecret({})).toThrow(/UDP_HMAC_SECRET/);
  });

  it('refuses a secret under 32 characters', () => {
    expect(() => readSharedSecret({ UDP_HMAC_SECRET: 'too-short' })).toThrow(
      /32/,
    );
  });

  it('returns a long enough secret', () => {
    expect(readSharedSecret({ UDP_HMAC_SECRET: secret })).toBe(secret);
  });
});

describe('MessageVerifier.verifyPacket', () => {
  it('accepts a fresh packet signed with the shared secret', () => {
    const result = new MessageVerifier(secret).verifyPacket(
      signPacket(line, secret, now),
      now,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.payload.toString()).toBe(line.toString());
  });

  it('matches the frame layout the Pi builds', () => {
    const timestamp = Buffer.alloc(8);
    timestamp.writeBigInt64BE(BigInt(now));
    const mac = createHmac('sha256', secret)
      .update(timestamp)
      .update(line)
      .digest();
    const packet = Buffer.concat([timestamp, mac, line]);
    expect(packet.equals(signPacket(line, secret, now))).toBe(true);
  });

  it('rejects an unsigned line', () => {
    const result = new MessageVerifier(secret).verifyPacket(line, now);
    expect(result).toEqual({ ok: false, reason: 'size' });
  });

  it('rejects a packet signed with another secret', () => {
    const packet = signPacket(line, 'another-secret-0123456789abcdefgh', now);
    expect(new MessageVerifier(secret).verifyPacket(packet, now)).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('rejects a payload changed after signing', () => {
    const packet = signPacket(line, secret, now);
    packet[packet.length - 2] ^= 0x01;
    expect(new MessageVerifier(secret).verifyPacket(packet, now)).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('rejects a timestamp changed after signing', () => {
    const packet = signPacket(line, secret, now);
    packet.writeBigInt64BE(BigInt(now + 1), 0);
    expect(new MessageVerifier(secret).verifyPacket(packet, now)).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('rejects a packet older than 2 s', () => {
    const packet = signPacket(line, secret, now - 2001);
    expect(new MessageVerifier(secret).verifyPacket(packet, now)).toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('rejects a packet more than 1 s in the future', () => {
    const packet = signPacket(line, secret, now + 1001);
    expect(new MessageVerifier(secret).verifyPacket(packet, now)).toEqual({
      ok: false,
      reason: 'future',
    });
  });

  it('rejects the second copy of a packet', () => {
    const verifier = new MessageVerifier(secret);
    const packet = signPacket(line, secret, now);
    expect(verifier.verifyPacket(packet, now).ok).toBe(true);
    expect(verifier.verifyPacket(packet, now + 500)).toEqual({
      ok: false,
      reason: 'replay',
    });
  });

  it('rejects an oversized packet before computing anything', () => {
    const packet = signPacket(Buffer.alloc(MAX_PACKET_BYTES), secret, now);
    expect(new MessageVerifier(secret).verifyPacket(packet, now)).toEqual({
      ok: false,
      reason: 'size',
    });
  });

  it('forgets old signatures so memory stays bounded', () => {
    const verifier = new MessageVerifier(secret);
    verifier.verifyPacket(signPacket(line, secret, now), now);
    verifier.verifyPacket(signPacket(line, secret, now + 3000), now + 3000);
    expect((verifier as unknown as { seen: Map<string, number> }).seen.size).toBe(1);
  });
});

describe('MessageVerifier.verifyUpload', () => {
  const query = 'cameraId=jean';
  const body = Buffer.from([0xff, 0xd8, 1, 2, 3, 4, 5, 6]);

  it('accepts an upload signed like the Pi does', () => {
    const { timestamp, signature } = signUpload(query, body, secret, now);
    const result = new MessageVerifier(secret).verifyUpload(
      { timestamp, signature, query, body },
      now,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects an upload without signature headers', () => {
    const result = new MessageVerifier(secret).verifyUpload(
      { timestamp: undefined, signature: undefined, query, body },
      now,
    );
    expect(result).toEqual({ ok: false, reason: 'signature' });
  });

  it('rejects an upload for another camera than the one signed', () => {
    const { timestamp, signature } = signUpload(query, body, secret, now);
    const result = new MessageVerifier(secret).verifyUpload(
      { timestamp, signature, query: 'cameraId=walid', body },
      now,
    );
    expect(result).toEqual({ ok: false, reason: 'signature' });
  });

  it('rejects an image swapped after signing', () => {
    const { timestamp, signature } = signUpload(query, body, secret, now);
    const result = new MessageVerifier(secret).verifyUpload(
      { timestamp, signature, query, body: Buffer.from([0xff, 0xd8, 9]) },
      now,
    );
    expect(result).toEqual({ ok: false, reason: 'signature' });
  });

  it('rejects a stale upload', () => {
    const { timestamp, signature } = signUpload(query, body, secret, now - 5000);
    const result = new MessageVerifier(secret).verifyUpload(
      { timestamp, signature, query, body },
      now,
    );
    expect(result).toEqual({ ok: false, reason: 'stale' });
  });

  it('rejects a replayed upload', () => {
    const verifier = new MessageVerifier(secret);
    const signed = signUpload(query, body, secret, now);
    const upload = { ...signed, query, body };
    expect(verifier.verifyUpload(upload, now).ok).toBe(true);
    expect(verifier.verifyUpload(upload, now + 100)).toEqual({
      ok: false,
      reason: 'replay',
    });
  });

  it('rejects a signature that is not 64 hex characters', () => {
    const result = new MessageVerifier(secret).verifyUpload(
      { timestamp: String(now), signature: 'abc', query, body },
      now,
    );
    expect(result).toEqual({ ok: false, reason: 'signature' });
  });
});
