import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UdpService } from './udp.service';
import { EventsGateway } from './events.gateway';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';

@Module({
  imports: [],
  controllers: [AppController, CamerasController],
  providers: [AppService, UdpService, EventsGateway, CamerasService],
})
export class AppModule {}

