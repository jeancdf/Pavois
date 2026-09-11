import { BadRequestException, Controller, Post, Query, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PreviewService } from './preview.service';

@Controller()
export class PreviewController {
  constructor(private readonly previews: PreviewService) {}

  /** JPEG live preview from a Pi (2 fps). Same trust model as UDP. */
  @SkipThrottle()
  @Post(['preview', 'api/preview'])
  ingest(
    @Query('cameraId') cameraId: string,
    @Req() req: Request,
  ): { ok: true } {
    const body = req.body;
    const jpeg = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
    if (!this.previews.ingest(cameraId || '', jpeg)) {
      throw new BadRequestException('preview JPEG invalide');
    }
    return { ok: true };
  }
}
