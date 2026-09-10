import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthTokenGuard } from './access-control';
import { AttitudeDto } from './attitude.dto';
import { UdpService } from './udp.service';

@Controller()
@UseGuards(AuthTokenGuard)
export class AttitudeController {
  constructor(private readonly udpService: UdpService) {}

  /** Same payload as UDP `att` — usable when 41234/udp is firewalled. */
  @SkipThrottle()
  @Post('attitude')
  ingest(@Body() body: AttitudeDto): { ok: true } {
    this.udpService.ingestAttitude({
      cameraId: body.cameraId,
      headingDeg: body.headingDeg,
      elevationDeg: body.elevationDeg,
      rollDeg: body.rollDeg,
      timestamp: body.timestamp ?? Date.now(),
    });
    return { ok: true };
  }
}
