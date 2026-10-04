import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UdpService } from './udp.service';
import { EventsGateway } from './events.gateway';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';
import { AuthController } from './auth/auth.controller';
import { AttitudeController } from './attitude.controller';
import { PreviewController } from './preview.controller';
import { PreviewService } from './preview.service';
import { FusionController } from './fusion.controller';
import { FusionService } from './fusion.service';
import { TracksController } from './tracks.controller';
import { TracksService } from './tracks.service';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { BenchController } from './bench.controller';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';
import { TuningController } from './tuning.controller';
import { TuningService } from './tuning.service';
import { CameraHealthService } from './camera-health.service';
import { DiscordNotificationChannel } from './discord-notification.channel';
import { AlertsCleanUpService } from './alerts-clean-up.service';
import { SimulationService } from './simulation.service';
import { ALERT_STORE, CAMERA_LOG_STORE } from './stores/alert-store.interface';
import { TRACK_STORE } from './stores/track-store.interface';
import { JsonlAlertStore } from './stores/jsonl-alert.store';
import { JsonlTrackStore } from './stores/jsonl-track.store';

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
    TuningController,
  ],
  providers: [
    AppService,
    UdpService,
    EventsGateway,
    CamerasService,
    PreviewService,
    FusionService,
    JsonlAlertStore,
    JsonlTrackStore,
    {
      provide: ALERT_STORE,
      useClass: JsonlAlertStore,
    },
    {
      provide: CAMERA_LOG_STORE,
      useExisting: JsonlAlertStore,
    },
    {
      provide: TRACK_STORE,
      useClass: JsonlTrackStore,
    },
    TracksService,
    AlertsService,
    ClassificationService,
    TuningService,
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
