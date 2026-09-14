import { Test, TestingModule } from '@nestjs/testing';
import { BenchController } from './bench.controller';
import { CamerasService } from './cameras.service';
import { EventsGateway } from './events.gateway';
import { buildRailBenchState } from './rail-bench';

describe('BenchController', () => {
  let controller: BenchController;
  const cameras = {
    applyRailBench: jest.fn(),
    clearRailBench: jest.fn(),
    railBenchState: jest.fn(),
    list: jest.fn().mockReturnValue([]),
  };
  const events = { broadcast: jest.fn() };

  beforeEach(async () => {
    cameras.applyRailBench.mockReset();
    cameras.clearRailBench.mockReset();
    cameras.railBenchState.mockReset();
    events.broadcast.mockReset();
    cameras.list.mockReturnValue([]);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BenchController],
      providers: [
        { provide: CamerasService, useValue: cameras },
        { provide: EventsGateway, useValue: events },
      ],
    }).compile();
    controller = module.get(BenchController);
  });

  it('starts the rail bench and broadcasts local poses', () => {
    const bench = buildRailBenchState({ rangeM: 2 });
    cameras.applyRailBench.mockReturnValue(bench);
    expect(controller.start({ rangeM: 2 })).toBe(bench);
    expect(events.broadcast).toHaveBeenCalledWith('rail_bench', {
      active: true,
      bench,
    });
  });

  it('stops the rail bench', () => {
    cameras.railBenchState.mockReturnValue(null);
    expect(controller.stop()).toEqual({ active: false, bench: null });
    expect(cameras.clearRailBench).toHaveBeenCalled();
  });
});
