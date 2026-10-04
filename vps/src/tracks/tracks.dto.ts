import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { TrackVerdict } from './track-types';

/** JSON body for PATCH /tracks/:id — human review for accuracy analysis. */
export class ReviewTrackDto {
  @IsEnum(TrackVerdict)
  verdict!: TrackVerdict;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
