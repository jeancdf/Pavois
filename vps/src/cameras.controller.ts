import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthTokenGuard } from './auth/access-control';
import { CamerasService, isCameraPosition } from './cameras.service';
import type { CameraConfig } from './cameras.service';
import { EventsGateway } from './realtime/events.gateway';

@Controller('cameras')
@UseGuards(AuthTokenGuard)
export class CamerasController {
  constructor(
    private readonly camerasService: CamerasService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  @Get()
  list(): CameraConfig[] {
    return this.camerasService.list();
  }

  @Put(':id/position')
  updatePosition(@Param('id') id: string, @Body() body: unknown): CameraConfig {
    if (!isCameraPosition(body)) {
      throw new BadRequestException(
        'Position invalide : lat entre -90 et 90, lon entre -180 et 180, alt en mètres',
      );
    }

    const camera = this.camerasService.updatePosition(id, body);
    // Les autres opérateurs connectés voient la caméra bouger immédiatement
    this.eventsGateway.broadcast('camera_positions', this.camerasService.list());
    return camera;
  }
}
