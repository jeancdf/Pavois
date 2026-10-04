import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthTokenGuard } from './auth/access-control';
import { EventsGateway } from './realtime/events.gateway';
import { TuningService } from './tuning.service';
import type { TuningState } from './tuning.service';
import { UdpService } from './udp/udp.service';

// Un curseur que l'on fait glisser envoie plusieurs requêtes par seconde : la
// limite générale (100 par minute) couperait le réglage en plein geste.
const SLIDER_THROTTLE = { default: { limit: 1200, ttl: 60000 } };

function objectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Corps JSON attendu');
  }
  return body as Record<string, unknown>;
}

function cameraIdsOf(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === 'string' && item.length > 0)
  ) {
    throw new BadRequestException(
      'cameraIds : une liste non vide d’identifiants de caméra est attendue',
    );
  }
  return value as string[];
}

@Controller('tuning')
@UseGuards(AuthTokenGuard)
export class TuningController {
  constructor(
    private readonly tuning: TuningService,
    private readonly udp: UdpService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  @Get()
  state(): TuningState {
    return this.tuning.state();
  }

  @Throttle(SLIDER_THROTTLE)
  @Put('fusion')
  setFusion(@Body() body: unknown): TuningState {
    this.tuning.setFusion(objectBody(body).values);
    return this.publish();
  }

  @Delete('fusion')
  resetFusion(): TuningState {
    this.tuning.resetFusion();
    return this.publish();
  }

  /** Sans `cameraIds`, le réglage part vers toutes les caméras. */
  @Throttle(SLIDER_THROTTLE)
  @Put('detector')
  setDetector(@Body() body: unknown): TuningState {
    const { cameraIds, values } = objectBody(body);
    this.tuning.setDetector(cameraIdsOf(cameraIds), values);
    return this.publish();
  }

  @Delete('detector')
  resetDetector(@Query('cameraId') cameraId?: string): TuningState {
    this.tuning.resetDetector(cameraId ? [cameraId] : undefined);
    return this.publish();
  }

  @Post('presets')
  savePreset(@Body() body: unknown): TuningState {
    this.tuning.savePreset(body);
    return this.publish();
  }

  @Delete('presets/:id')
  deletePreset(@Param('id') id: string): TuningState {
    this.tuning.deletePreset(id);
    return this.publish();
  }

  @Post('presets/:id/apply')
  applyPreset(@Param('id') id: string): TuningState {
    this.tuning.applyPreset(id);
    return this.publish();
  }

  // Les détecteurs reçoivent leur commande tout de suite, et les autres
  // opérateurs connectés voient le même panneau.
  private publish(): TuningState {
    this.udp.pushTuning();
    const state = this.tuning.state();
    this.eventsGateway.broadcast('tuning_state', state);
    return state;
  }
}
