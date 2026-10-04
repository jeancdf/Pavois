import { IsNumber, IsOptional, Max, Min } from 'class-validator';

/** JSON body for POST /bench/rail. All fields optional. */
export class RailBenchDto {
  @IsOptional()
  @IsNumber()
  @Min(840)
  @Max(1050)
  rigWidthMm?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(20)
  rangeM?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.05)
  @Max(2)
  targetSizeM?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  hoverM?: number;

  @IsOptional()
  @IsNumber()
  headingDeg?: number;

  @IsOptional()
  @IsNumber()
  elevationDeg?: number;
}
