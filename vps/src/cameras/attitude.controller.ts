import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthTokenGuard } from '../auth/access-control';
import { AttitudeDto } from './attitude.dto';
import { parseCalibrationToken } from '../udp/udp-attitude';
import { UdpService } from '../udp/udp.service';

@Controller()
@UseGuards(AuthTokenGuard)
export class AttitudeController {
  constructor(private readonly udpService: UdpService) {}

  /** Same payload as UDP `att` — usable when 41234/udp is firewalled. */
  @SkipThrottle()
  @Post('attitude')
  ingest(@Body() body: AttitudeDto): { ok: true } {
    const calibration =
      body.calib === undefined ? null : parseCalibrationToken(body.calib);
    if (calibration === undefined) {
      throw new BadRequestException('calib must be SGAM (0-3 or -) or -');
    }
    this.udpService.ingestAttitude({
      cameraId: body.cameraId,
      headingDeg: body.headingDeg,
      elevationDeg: body.elevationDeg,
      rollDeg: body.rollDeg,
      timestamp: body.timestamp ?? Date.now(),
      calibration,
      valid: body.valid ?? true,
    });
    return { ok: true };
  }
}
