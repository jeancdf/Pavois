import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthTokenGuard } from './auth/access-control';
import { CamerasService } from './cameras.service';
import { EventsGateway } from './events.gateway';
import { RailBenchDto } from './rail-bench.dto';
import type { RailBenchState } from './rail-bench';

@Controller('bench')
@UseGuards(AuthTokenGuard)
export class BenchController {
  constructor(
    private readonly camerasService: CamerasService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  @Get('rail')
  status(): { active: boolean; bench: RailBenchState | null } {
    const bench = this.camerasService.railBenchState();
    return { active: bench !== null, bench };
  }

  @Post('rail')
  start(@Body() body: RailBenchDto): RailBenchState {
    const bench = this.camerasService.applyRailBench(body ?? {});
    this.broadcastBench(bench);
    return bench;
  }

  @Delete('rail')
  stop(): { active: false; bench: null } {
    this.camerasService.clearRailBench();
    this.broadcastBench(null);
    return { active: false, bench: null };
  }

  private broadcastBench(bench: RailBenchState | null): void {
    this.eventsGateway.broadcast(
      'camera_positions',
      this.camerasService.list(),
    );
    this.eventsGateway.broadcast('rail_bench', {
      active: bench !== null,
      bench,
    });
  }
}
