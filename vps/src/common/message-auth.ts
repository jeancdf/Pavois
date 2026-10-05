import { createHmac, timingSafeEqual } from 'crypto';

export const MIN_SECRET_LENGTH = 32;
export const TIMESTAMP_BYTES = 8;
export const SIGNATURE_BYTES = 32;
export const HEADER_BYTES = TIMESTAMP_BYTES + SIGNATURE_BYTES;
export const MAX_PACKET_BYTES = 2048;
export const MAX_AGE_MS = 2000;
export const MAX_FUTURE_MS = 1000;

const REPLAY_MEMORY_MS = MAX_AGE_MS + 500;
const REPLAY_CAPACITY = 5000;
const HEX_SIGNATURE = /^[0-9a-f]{64}$/i;

export type RejectReason = 'size' | 'stale' | 'future' | 'signature' | 'replay';

export type Verification =
  | { ok: true; payload: Buffer }
  | { ok: false; reason: RejectReason };

export interface SignedUpload {
  timestamp: string | undefined;
  signature: string | undefined;
  query: string;
  body: Buffer;
}

export function readSharedSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.UDP_HMAC_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `UDP_HMAC_SECRET doit contenir au moins ${MIN_SECRET_LENGTH} caractères`,
    );
  }
  return secret;
}

export function signPacket(
  payload: Buffer,
  secret: string,
  nowMs = Date.now(),
): Buffer {
  const timestamp = Buffer.alloc(TIMESTAMP_BYTES);
  timestamp.writeBigInt64BE(BigInt(nowMs));
  const signature = createHmac('sha256', secret)
    .update(timestamp)
    .update(payload)
    .digest();
  return Buffer.concat([timestamp, signature, payload]);
}

export function signUpload(
  query: string,
  body: Buffer,
  secret: string,
  nowMs = Date.now(),
): { timestamp: string; signature: string } {
  const timestamp = String(nowMs);
  const signature = uploadSignature(timestamp, query, body, secret);
  return { timestamp, signature: signature.toString('hex') };
}

export class MessageVerifier {
  private readonly seen = new Map<string, number>();

  constructor(private readonly secret: string) {}

  verifyPacket(packet: Buffer, nowMs = Date.now()): Verification {
    if (packet.length <= HEADER_BYTES || packet.length > MAX_PACKET_BYTES) {
      return { ok: false, reason: 'size' };
    }
    const freshness = checkFreshness(Number(packet.readBigInt64BE(0)), nowMs);
    if (freshness) return { ok: false, reason: freshness };

    const received = packet.subarray(TIMESTAMP_BYTES, HEADER_BYTES);
    const payload = packet.subarray(HEADER_BYTES);
    const expected = createHmac('sha256', this.secret)
      .update(packet.subarray(0, TIMESTAMP_BYTES))
      .update(payload)
      .digest();
    if (!timingSafeEqual(received, expected)) {
      return { ok: false, reason: 'signature' };
    }
    if (!this.firstTime(expected, nowMs)) return { ok: false, reason: 'replay' };
    return { ok: true, payload: Buffer.from(payload) };
  }

  verifyUpload(upload: SignedUpload, nowMs = Date.now()): Verification {
    const { timestamp, signature, query, body } = upload;
    if (!timestamp || !/^\d{1,16}$/.test(timestamp)) {
      return { ok: false, reason: 'signature' };
    }
    const freshness = checkFreshness(Number(timestamp), nowMs);
    if (freshness) return { ok: false, reason: freshness };

    if (!signature || !HEX_SIGNATURE.test(signature)) {
      return { ok: false, reason: 'signature' };
    }
    const expected = uploadSignature(timestamp, query, body, this.secret);
    if (!timingSafeEqual(Buffer.from(signature, 'hex'), expected)) {
      return { ok: false, reason: 'signature' };
    }
    if (!this.firstTime(expected, nowMs)) return { ok: false, reason: 'replay' };
    return { ok: true, payload: body };
  }

  private firstTime(signature: Buffer, nowMs: number): boolean {
    for (const [key, seenAt] of this.seen) {
      if (nowMs - seenAt <= REPLAY_MEMORY_MS) break;
      this.seen.delete(key);
    }
    const key = signature.toString('base64');
    if (this.seen.has(key)) return false;
    if (this.seen.size >= REPLAY_CAPACITY) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.set(key, nowMs);
    return true;
  }
}

function checkFreshness(
  timestampMs: number,
  nowMs: number,
): 'stale' | 'future' | null {
  if (nowMs - timestampMs > MAX_AGE_MS) return 'stale';
  if (timestampMs - nowMs > MAX_FUTURE_MS) return 'future';
  return null;
}

function uploadSignature(
  timestamp: string,
  query: string,
  body: Buffer,
  secret: string,
): Buffer {
  return createHmac('sha256', secret)
    .update(`${timestamp}\n${query}\n`)
    .update(body)
    .digest();
}
