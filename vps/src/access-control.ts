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

/** Valeurs d'exemple présentes dans les fichiers .env.*example du dépôt : jamais acceptées comme jeton réel. */
const PLACEHOLDER_AUTH_TOKENS = new Set(['dev-pavois-token', 'change-me', 'staging-token-change-me']);

/**
 * Vérifie que WS_AUTH_TOKEN est défini et n'est pas une valeur d'exemple publiée dans le dépôt.
 * À appeler au démarrage : on préfère un échec explicite au boot à une authentification
 * silencieusement contournable si la variable d'environnement est absente.
 */
export function assertAuthTokenConfigured(): void {
  const token = process.env.WS_AUTH_TOKEN;
  if (!token || PLACEHOLDER_AUTH_TOKENS.has(token)) {
    throw new Error(
      "WS_AUTH_TOKEN est absent ou correspond à une valeur d'exemple (.env.example). " +
        "Définissez un jeton secret réel dans l'environnement avant de démarrer le serveur.",
    );
  }
}

export function isValidAuthToken(token: string | null | undefined): boolean {
  const expectedToken = process.env.WS_AUTH_TOKEN;
  return !!expectedToken && !!token && token === expectedToken;
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
