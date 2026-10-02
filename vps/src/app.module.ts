import { Module, forwardRef } from '@nestjs/common';
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
import { FusionController } from './fusion.controller';
import { FusionService } from './fusion.service';
import { PrismaService } from './prisma.service';
import { TracksController } from './tracks.controller';
import { TracksService } from './tracks.service';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { BenchController } from './bench.controller';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';
import { CameraHealthService } from './camera-health.service';
import { DiscordNotificationChannel } from './discord-notification.channel';
import { AlertsCleanUpService } from './alerts-clean-up.service';
import { SimulationService } from './simulation.service';

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
    FusionController,
    TracksController,
    AlertsController,
    BenchController,
    ClassificationController,
  ],
  providers: [
    AppService,
    UdpService,
    EventsGateway,
    CamerasService,
    PreviewService,
    FusionService,
    PrismaService,
    TracksService,
    AlertsService,
    ClassificationService,
    CameraHealthService,
    DiscordNotificationChannel,
    AlertsCleanUpService,
    SimulationService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
