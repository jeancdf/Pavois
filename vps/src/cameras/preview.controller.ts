import {
  BadRequestException,
  Controller,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PreviewService } from './preview.service';
import { ImageUploadsGuard } from '../common/image-uploads.guard';
import { SignedUploadGuard } from '../common/signed-upload.guard';

@Controller()
export class PreviewController {
  constructor(private readonly previews: PreviewService) {}

  @SkipThrottle()
  @UseGuards(ImageUploadsGuard, SignedUploadGuard)
  @Post(['preview', 'api/preview'])
  ingest(
    @Query('cameraId') cameraId: string,
    @Req() req: Request,
  ): { ok: true } {
    const body: unknown = req.body;
    const jpeg = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
    if (!this.previews.ingest(cameraId || '', jpeg)) {
      throw new BadRequestException('preview JPEG invalide');
    }
    return { ok: true };
  }
}
