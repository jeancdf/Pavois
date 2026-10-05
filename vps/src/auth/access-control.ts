import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { IncomingMessage } from 'http';

export interface OperatorIdentity {
  valid: boolean;
  username: string;
}

export const MIN_TOKEN_LENGTH = 24;

const PLACEHOLDER_AUTH_TOKENS = new Set([
  'dev-pavois-token',
  'change-me',
  'staging-token-change-me',
]);
const OPERATOR_NAME = /^[\p{L}\p{N}._-]{1,32}$/u;
const DENIED: OperatorIdentity = { valid: false, username: '' };

export function getClientIp(request: IncomingMessage): string {
  const realIp = request.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim().length > 0) {
    return realIp.trim();
  }
  return request.socket.remoteAddress ?? 'unknown';
}

export function isIpAllowed(ip: string): boolean {
  const allowedIpsStr = process.env.ALLOWED_IPS;
  if (!allowedIpsStr) return true;
  const allowedIps = allowedIpsStr.split(',').map((allowed) => allowed.trim());
  return allowedIps.includes(ip);
}

export function assertAuthTokenConfigured(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const token = env.WS_AUTH_TOKEN ?? '';
  if (!token) {
    throw new Error('WS_AUTH_TOKEN est obligatoire');
  }
  if (env.NODE_ENV !== 'production') return;
  if (PLACEHOLDER_AUTH_TOKENS.has(token) || token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `WS_AUTH_TOKEN doit être un secret d'au moins ${MIN_TOKEN_LENGTH} caractères, pas une valeur d'exemple`,
    );
  }
}

export function verifyOperatorToken(
  token: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): OperatorIdentity {
  const expected = env.WS_AUTH_TOKEN;
  if (!token || !expected) return DENIED;

  if (token.startsWith('op:')) {
    const separator = token.indexOf(':', 3);
    if (separator < 0) return DENIED;
    const username = token.slice(3, separator);
    const secret = token.slice(separator + 1);
    return OPERATOR_NAME.test(username) && sameSecret(secret, expected)
      ? { valid: true, username }
      : DENIED;
  }

  return sameSecret(token, expected)
    ? { valid: true, username: 'opérateur-1' }
    : DENIED;
}

function sameSecret(candidate: string, expected: string): boolean {
  return timingSafeEqual(digest(candidate), digest(expected));
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

@Injectable()
export class AuthTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<IncomingMessage>();
    if (!isIpAllowed(getClientIp(request))) {
      throw new ForbiddenException('Forbidden IP');
    }

    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : null;
    if (!verifyOperatorToken(token).valid) {
      throw new UnauthorizedException("Jeton d'authentification invalide");
    }
    return true;
  }
}
