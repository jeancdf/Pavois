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
import { ClassificationService } from './classification.service';
import type { ClassificationCaptureMeta } from './classification.types';
import { SignedUploadGuard } from '../common/signed-upload.guard';

function optionalNumber(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

@Controller()
export class ClassificationController {
  constructor(private readonly classification: ClassificationService) {}

  @SkipThrottle()
  @UseGuards(SignedUploadGuard)
  @Post(['classification/capture', 'api/classification/capture'])
  ingest(
    @Query('requestId') requestId: string,
    @Query('cameraId') cameraId: string,
    @Query('capturedUs') capturedUs: string | undefined,
    @Query('frameId') frameId: string | undefined,
    @Query('cx') cx: string | undefined,
    @Query('cy') cy: string | undefined,
    @Query('x0') x0: string | undefined,
    @Query('y0') y0: string | undefined,
    @Query('x1') x1: string | undefined,
    @Query('y1') y1: string | undefined,
    @Query('area') area: string | undefined,
    @Req() req: Request,
  ): { ok: true } {
    const meta: ClassificationCaptureMeta = {
      requestId: requestId ?? '',
      cameraId: cameraId ?? '',
      capturedUs: optionalNumber(capturedUs),
      frameId: optionalNumber(frameId),
      cx: optionalNumber(cx),
      cy: optionalNumber(cy),
      x0: optionalNumber(x0),
      y0: optionalNumber(y0),
      x1: optionalNumber(x1),
      y1: optionalNumber(y1),
      area: optionalNumber(area),
    };
    const body: unknown = req.body;
    const jpeg = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
    if (!this.classification.ingestCapture(meta, jpeg)) {
      throw new BadRequestException('capture inconnue, expirée ou invalide');
    }
    return { ok: true };
  }
}
