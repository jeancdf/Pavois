import { IsNumber, IsOptional, IsString } from 'class-validator';

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
}
