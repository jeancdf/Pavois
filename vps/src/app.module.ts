import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UdpService } from './udp.service';
import { EventsGateway } from './events.gateway';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, UdpService, EventsGateway],
})
export class AppModule {}

