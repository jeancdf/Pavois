import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

/** JSON body for POST /attitude (TCP fallback when UDP is filtered). */
export class AttitudeDto {
  @IsString()
  cameraId!: string;

  @IsNumber()
  headingDeg!: number;

  @IsNumber()
  elevationDeg!: number;

  @IsNumber()
  rollDeg!: number;

  @IsOptional()
  @IsNumber()
  timestamp?: number;

  /** Même jeton que la trame UDP `att` : SGAM (0-3 ou `-`) ou `-`. */
  @IsOptional()
  @IsString()
  @Matches(/^([0-3-]{4}|-)$/)
  calib?: string;

  /** false : lecture IMU ratée, cap figé. Défaut true. */
  @IsOptional()
  @IsBoolean()
  valid?: boolean;
}
