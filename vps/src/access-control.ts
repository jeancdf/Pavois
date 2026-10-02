import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { IncomingMessage } from 'http';

// Contrôles d'accès communs au WebSocket et à l'API HTTP.

export interface OperatorIdentity {
  valid: boolean;
  username: string;
}

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

/** Valeurs d'exemple : jamais acceptées en PROD ou si configurées. */
const PLACEHOLDER_AUTH_TOKENS = new Set([
  'dev-pavois-token',
  'change-me',
  'staging-token-change-me',
]);

export function assertAuthTokenConfigured(): void {
  const token = process.env.WS_AUTH_TOKEN;
  if (
    process.env.NODE_ENV === 'production' &&
    (!token || PLACEHOLDER_AUTH_TOKENS.has(token))
  ) {
    throw new Error(
      "WS_AUTH_TOKEN est absent ou correspond à une valeur d'exemple (.env.example). " +
        "Définissez un jeton secret réel dans l'environnement avant de démarrer le serveur en production.",
    );
  }
}

/**
 * Valide et extrait l'identité de l'opérateur à partir du jeton.
 * Format supporté :
 * 1) "op:<username>:<secret>" (ex: "op:alice:secret-token")
 * 2) "<secret>" (opérateur par défaut "opérateur-1")
 */
export function verifyOperatorToken(
  token: string | null | undefined,
): OperatorIdentity {
  const expectedToken = process.env.WS_AUTH_TOKEN || 'dev-pavois-token';
  const isProduction = process.env.NODE_ENV === 'production';

  if (!token) {
    return { valid: false, username: '' };
  }

  // En production, aucun jeton de dev ou placeholder n'est accepté
  if (isProduction && PLACEHOLDER_AUTH_TOKENS.has(token)) {
    return { valid: false, username: '' };
  }

  if (token.startsWith('op:')) {
    const parts = token.split(':');
    if (parts.length === 3 && parts[1] && parts[2] === expectedToken) {
      return { valid: true, username: parts[1] };
    }
  }

  if (token === expectedToken) {
    return { valid: true, username: 'opérateur-1' };
  }

  return { valid: false, username: '' };
}

export function isValidAuthToken(token: string | null | undefined): boolean {
  return verifyOperatorToken(token).valid;
}

/** Jeton transmis en `Authorization: Bearer <token>`. */
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
    const authResult = verifyOperatorToken(token);
    if (!authResult.valid) {
      throw new UnauthorizedException('Jeton d\'authentification invalide');
    }
    return true;
  }
}
