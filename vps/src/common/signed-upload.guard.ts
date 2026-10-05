import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { MessageVerifier, readSharedSecret } from './message-auth';

@Injectable()
export class SignedUploadGuard implements CanActivate {
  private readonly verifier = new MessageVerifier(readSharedSecret());

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const body: unknown = request.body;
    const verification = this.verifier.verifyUpload({
      timestamp: request.get('x-pavois-timestamp'),
      signature: request.get('x-pavois-signature'),
      query: rawQuery(request.originalUrl),
      body: Buffer.isBuffer(body) ? body : Buffer.alloc(0),
    });
    if (!verification.ok) {
      throw new UnauthorizedException('Signature invalide');
    }
    return true;
  }
}

export function rawQuery(url: string): string {
  const start = url.indexOf('?');
  return start < 0 ? '' : url.slice(start + 1);
}
