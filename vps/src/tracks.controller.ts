import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthTokenGuard } from './auth/access-control';
import { TracksService } from './tracks.service';
import { ReviewTrackDto } from './tracks.dto';
import { TrackVerdict, Track } from './track-types';

@Controller('tracks')
@UseGuards(AuthTokenGuard)
export class TracksController {
  constructor(private readonly tracks: TracksService) {}

  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('classification') classification?: string,
    @Query('verdict') verdict?: string,
  ): Promise<Track[]> {
    return this.tracks.list({
      limit: limit ? Number.parseInt(limit, 10) : undefined,
      before,
      classification,
      verdict: parseVerdictFilter(verdict),
    });
  }

  @Patch(':id')
  review(@Param('id') id: string, @Body() body: ReviewTrackDto): Promise<Track> {
    return this.tracks.setVerdict(id, body.verdict, body.note);
  }
}

function parseVerdictFilter(
  raw: string | undefined,
): TrackVerdict | 'UNREVIEWED' | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'UNREVIEWED') return 'UNREVIEWED';
  if (raw === TrackVerdict.CONFIRMED || raw === TrackVerdict.FALSE_POSITIVE) {
    return raw;
  }
  throw new BadRequestException(
    'verdict must be CONFIRMED, FALSE_POSITIVE or UNREVIEWED',
  );
}
