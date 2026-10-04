import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthTokenGuard } from '../auth/access-control';
import { FusionService } from './fusion.service';
import type { FusionSnapshot } from './fusion.types';

@Controller('fusion')
@UseGuards(AuthTokenGuard)
export class FusionController {
  constructor(private readonly fusion: FusionService) {}

  /** GET /fusion : renvoie l'état actuel du moteur de fusion. */
  @Get()
  status(): FusionSnapshot {
    return this.fusion.snapshot();
  }
}
