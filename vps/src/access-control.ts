import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { IncomingMessage } from 'http';

// Contrôles d'accès communs au WebSocket et à l'API HTTP.

export function getClientIp(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return ip.trim();
  }
  return request.socket.remoteAddress || 'unknown';
}

/** Liste blanche ALLOWED_IPS : sans valeur, toutes les IP sont acceptées. */
export function isIpAllowed(ip: string): boolean {
  const allowedIpsStr = process.env.ALLOWED_IPS;
  if (!allowedIpsStr) return true;
  const allowedIps = allowedIpsStr.split(',').map((allowed) => allowed.trim());
  return allowedIps.includes(ip);
}

export function isValidAuthToken(token: string | null | undefined): boolean {
  const expectedToken = process.env.WS_AUTH_TOKEN || 'dev-pavois-token';
  return !!token && token === expectedToken;
}

/** Même jeton que le WebSocket, transmis en `Authorization: Bearer <token>`. */
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
    if (!isValidAuthToken(token)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
