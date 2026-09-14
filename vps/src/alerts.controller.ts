import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthTokenGuard } from './access-control';
import { AlertsService } from './alerts.service';
import type { Alert } from '@prisma/client';

@Controller('alerts')
@UseGuards(AuthTokenGuard)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ): Promise<Alert[]> {
    return this.alerts.list({
      limit: limit ? Number.parseInt(limit, 10) : undefined,
      before,
    });
  }
}
