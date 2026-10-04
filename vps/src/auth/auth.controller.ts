import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthTokenGuard } from './access-control';

/** Vérifie le Bearer token avant d'ouvrir l'interface. */
@Controller('auth')
@UseGuards(AuthTokenGuard)
export class AuthController {
  @Get('verify')
  verify(): { ok: true } {
    return { ok: true };
  }
}
