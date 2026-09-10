import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UdpService } from './udp.service';
import { EventsGateway } from './events.gateway';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';
import { AuthController } from './auth.controller';
import { AttitudeController } from './attitude.controller';
import { PreviewController } from './preview.controller';
import { PreviewService } from './preview.service';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
  ],
  controllers: [
    AppController,
    AuthController,
    CamerasController,
    AttitudeController,
    PreviewController,
  ],
  providers: [
    AppService,
    UdpService,
    EventsGateway,
    CamerasService,
    PreviewService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

