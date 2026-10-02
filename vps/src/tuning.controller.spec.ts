import { Test, TestingModule } from '@nestjs/testing';
import { EventsGateway } from './events.gateway';
import { TuningController } from './tuning.controller';
import { TuningService } from './tuning.service';
import { UdpService } from './udp.service';

describe('TuningController', () => {
  let controller: TuningController;
  const state = { type: 'tuning_state', cameras: [] };
  const tuning = {
    state: jest.fn(),
    setFusion: jest.fn(),
    resetFusion: jest.fn(),
    setDetector: jest.fn(),
    resetDetector: jest.fn(),
    savePreset: jest.fn(),
    deletePreset: jest.fn(),
    applyPreset: jest.fn(),
  };
  const udp = { pushTuning: jest.fn() };
  const events = { broadcast: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    tuning.state.mockReturnValue(state);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TuningController],
      providers: [
        { provide: TuningService, useValue: tuning },
        { provide: UdpService, useValue: udp },
        { provide: EventsGateway, useValue: events },
      ],
    }).compile();
    controller = module.get(TuningController);
  });

  it('reads the state without sending anything', () => {
    expect(controller.state()).toBe(state);
    expect(udp.pushTuning).not.toHaveBeenCalled();
    expect(events.broadcast).not.toHaveBeenCalled();
  });

  it('pushes a detector change to the Pis and to every operator', () => {
    const values = { diff_threshold: 8 };
    expect(controller.setDetector({ cameraIds: ['jean'], values })).toBe(state);
    expect(tuning.setDetector).toHaveBeenCalledWith(['jean'], values);
    expect(udp.pushTuning).toHaveBeenCalledTimes(1);
    expect(events.broadcast).toHaveBeenCalledWith('tuning_state', state);
  });

  it('targets every camera when none is named', () => {
    controller.setDetector({ values: { diff_threshold: 8 } });
    expect(tuning.setDetector).toHaveBeenCalledWith(undefined, {
      diff_threshold: 8,
    });
    controller.resetDetector();
    expect(tuning.resetDetector).toHaveBeenCalledWith(undefined);
    controller.resetDetector('tanel');
    expect(tuning.resetDetector).toHaveBeenLastCalledWith(['tanel']);
  });

  it('refuses a malformed body before touching anything', () => {
    expect(() => controller.setDetector('nope')).toThrow(/Corps JSON/);
    expect(() => controller.setFusion([1])).toThrow(/Corps JSON/);
    expect(() =>
      controller.setDetector({ cameraIds: 'jean', values: {} }),
    ).toThrow(/cameraIds/);
    expect(() => controller.setDetector({ cameraIds: [], values: {} })).toThrow(
      /cameraIds/,
    );
    expect(tuning.setDetector).not.toHaveBeenCalled();
    expect(udp.pushTuning).not.toHaveBeenCalled();
  });

  it('publishes fusion changes and presets the same way', () => {
    controller.setFusion({ values: { maxResidualPx: 40 } });
    expect(tuning.setFusion).toHaveBeenCalledWith({ maxResidualPx: 40 });
    controller.resetFusion();
    controller.applyPreset('strict');
    expect(tuning.applyPreset).toHaveBeenCalledWith('strict');
    controller.savePreset({ name: 'Hangar', fusion: {} });
    controller.deletePreset('perso-1');
    expect(tuning.deletePreset).toHaveBeenCalledWith('perso-1');
    expect(udp.pushTuning).toHaveBeenCalledTimes(5);
    expect(events.broadcast).toHaveBeenCalledTimes(5);
  });

  it('does not publish when the service refuses the change', () => {
    tuning.setFusion.mockImplementationOnce(() => {
      throw new Error('hors des bornes');
    });
    expect(() =>
      controller.setFusion({ values: { maxResidualPx: 0 } }),
    ).toThrow(/hors des bornes/);
    expect(udp.pushTuning).not.toHaveBeenCalled();
    expect(events.broadcast).not.toHaveBeenCalled();
  });
});
