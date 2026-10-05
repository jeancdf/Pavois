import { IncomingMessage } from 'http';
import { Socket } from 'net';
import {
  assertAuthTokenConfigured,
  getClientIp,
  verifyOperatorToken,
} from './access-control';

const token = 'operator-token-0123456789abcdef';
const env = { WS_AUTH_TOKEN: token };

function requestFrom(
  remoteAddress: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  const socket = new Socket();
  Object.defineProperty(socket, 'remoteAddress', { value: remoteAddress });
  const request = new IncomingMessage(socket);
  request.headers = headers;
  return request;
}

describe('verifyOperatorToken', () => {
  it('accepts the configured token', () => {
    expect(verifyOperatorToken(token, env)).toEqual({
      valid: true,
      username: 'opérateur-1',
    });
  });

  it('names the operator from op:<name>:<token>', () => {
    expect(verifyOperatorToken(`op:alice:${token}`, env)).toEqual({
      valid: true,
      username: 'alice',
    });
  });

  it('rejects a wrong token', () => {
    expect(verifyOperatorToken('nimporte-quoi', env).valid).toBe(false);
  });

  it('rejects everything when no token is configured', () => {
    expect(verifyOperatorToken('dev-pavois-token', {}).valid).toBe(false);
    expect(verifyOperatorToken('', {}).valid).toBe(false);
  });

  it('rejects an operator name that could inject markup', () => {
    expect(verifyOperatorToken(`op:<b>x</b>:${token}`, env).valid).toBe(false);
  });

  it('rejects op: with a wrong secret', () => {
    expect(verifyOperatorToken('op:alice:wrong', env).valid).toBe(false);
  });
});

describe('assertAuthTokenConfigured', () => {
  it('refuses to start without a token', () => {
    expect(() => assertAuthTokenConfigured({})).toThrow(/WS_AUTH_TOKEN/);
  });

  it('refuses a sample token in production', () => {
    expect(() =>
      assertAuthTokenConfigured({
        NODE_ENV: 'production',
        WS_AUTH_TOKEN: 'change-me',
      }),
    ).toThrow(/24/);
  });

  it('refuses a short token in production', () => {
    expect(() =>
      assertAuthTokenConfigured({
        NODE_ENV: 'production',
        WS_AUTH_TOKEN: 'short-token',
      }),
    ).toThrow(/24/);
  });

  it('accepts a long secret in production', () => {
    expect(() =>
      assertAuthTokenConfigured({ NODE_ENV: 'production', WS_AUTH_TOKEN: token }),
    ).not.toThrow();
  });
});

describe('getClientIp', () => {
  it('uses the address Nginx writes in X-Real-IP', () => {
    const request = requestFrom('172.18.0.3', {
      'x-real-ip': '203.0.113.9',
      'x-forwarded-for': '1.2.3.4, 203.0.113.9',
    });
    expect(getClientIp(request)).toBe('203.0.113.9');
  });

  it('ignores a forged X-Forwarded-For', () => {
    const request = requestFrom('198.51.100.7', {
      'x-forwarded-for': '10.0.0.1',
    });
    expect(getClientIp(request)).toBe('198.51.100.7');
  });
});
