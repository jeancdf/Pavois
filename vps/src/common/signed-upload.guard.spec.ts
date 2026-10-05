import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { signUpload } from './message-auth';
import { rawQuery, SignedUploadGuard } from './signed-upload.guard';

const secret = 'upload-guard-secret-0123456789ab';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4]);

function contextFor(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): ExecutionContext {
  const request = {
    originalUrl: url,
    body,
    get: (name: string) => headers[name.toLowerCase()],
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function signedHeaders(query: string, body: Buffer): Record<string, string> {
  const { timestamp, signature } = signUpload(query, body, secret);
  return { 'x-pavois-timestamp': timestamp, 'x-pavois-signature': signature };
}

describe('SignedUploadGuard', () => {
  let guard: SignedUploadGuard;

  beforeEach(() => {
    process.env.UDP_HMAC_SECRET = secret;
    guard = new SignedUploadGuard();
  });

  afterEach(() => {
    delete process.env.UDP_HMAC_SECRET;
  });

  it('lets a signed preview through', () => {
    const query = 'cameraId=jean';
    const context = contextFor(
      `/preview?${query}`,
      signedHeaders(query, jpeg),
      jpeg,
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('accepts the path rewritten by Nginx', () => {
    const query = 'cameraId=jean&requestId=abc&cx=12.50';
    const context = contextFor(
      `/classification/capture?${query}`,
      signedHeaders(query, jpeg),
      jpeg,
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects an unsigned upload', () => {
    const context = contextFor('/preview?cameraId=jean', {}, jpeg);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a signed image sent again', () => {
    const query = 'cameraId=jean';
    const headers = signedHeaders(query, jpeg);
    expect(guard.canActivate(contextFor(`/preview?${query}`, headers, jpeg))).toBe(true);
    expect(() =>
      guard.canActivate(contextFor(`/preview?${query}`, headers, jpeg)),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a body that is not raw bytes', () => {
    const query = 'cameraId=jean';
    const context = contextFor(
      `/preview?${query}`,
      signedHeaders(query, jpeg),
      { image: 'json' },
    );
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('refuses to exist without a shared secret', () => {
    delete process.env.UDP_HMAC_SECRET;
    expect(() => new SignedUploadGuard()).toThrow(/UDP_HMAC_SECRET/);
  });
});

describe('rawQuery', () => {
  it('keeps the query exactly as received', () => {
    expect(rawQuery('/api/preview?cameraId=jean&x=1%202')).toBe(
      'cameraId=jean&x=1%202',
    );
  });

  it('returns an empty string without a query', () => {
    expect(rawQuery('/preview')).toBe('');
  });
});
