import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UdpService } from './udp/udp.service';
import { EventsGateway } from './realtime/events.gateway';
import { CamerasController } from './cameras/cameras.controller';
import { CamerasService } from './cameras/cameras.service';
import { AuthController } from './auth/auth.controller';
import { AttitudeController } from './cameras/attitude.controller';
import { PreviewController } from './cameras/preview.controller';
import { PreviewService } from './cameras/preview.service';
import { FusionController } from './fusion/fusion.controller';
import { FusionService } from './fusion/fusion.service';
import { TracksController } from './tracks/tracks.controller';
import { TracksService } from './tracks/tracks.service';
import { AlertsController } from './alerts/alerts.controller';
import { AlertsService } from './alerts/alerts.service';
import { BenchController } from './bench.controller';
import { ClassificationController } from './classification/classification.controller';
import { ClassificationService } from './classification/classification.service';
import { TuningController } from './tuning/tuning.controller';
import { TuningService } from './tuning/tuning.service';
import { CameraHealthService } from './cameras/camera-health.service';
import { DiscordNotificationChannel } from './notifications/discord-notification.channel';
import { AlertsCleanUpService } from './alerts/alerts-clean-up.service';
import { SimulationService } from './simulation.service';
import { ALERT_STORE, CAMERA_LOG_STORE } from './alerts/alert-store.interface';
import { TRACK_STORE } from './tracks/track-store.interface';
import { JsonlAlertStore } from './alerts/jsonl-alert.store';
import { JsonlTrackStore } from './tracks/jsonl-track.store';

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
