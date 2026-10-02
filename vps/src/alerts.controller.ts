import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthTokenGuard, verifyOperatorToken } from './access-control';
import { AlertsService } from './alerts.service';
import { Alert, AlertStatus } from '@prisma/client';
import { IncomingMessage } from 'http';

@Controller('alerts')
@UseGuards(AuthTokenGuard)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('status') status?: AlertStatus,
  ): Promise<Alert[]> {
    return this.alerts.list({
      limit: limit ? Number.parseInt(limit, 10) : undefined,
      before,
      status,
    });
  }

  @Post(':id/acknowledge')
  acknowledge(
    @Param('id') alertId: string,
    @Req() request: IncomingMessage,
  ): Promise<Alert> {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : null;
    const operator = verifyOperatorToken(token);
    const username = operator.valid ? operator.username : 'opérateur-inconnu';
    return this.alerts.acknowledge(alertId, username);
  }
}
