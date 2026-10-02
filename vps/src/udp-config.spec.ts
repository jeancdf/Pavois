import { parseDetectorConfigLine } from './udp-config';

describe('parseDetectorConfigLine', () => {
  it('parses the settings a detector reports', () => {
    const report = parseDetectorConfigLine(
      'cfg,jean,1775312345678,123456,width=640,height=360,diff_threshold=14,adaptive_k=2.2,bg_learn_rate_fg=0.002',
    );
    expect(report).toEqual({
      type: 'detector_config',
      cameraId: 'jean',
      timestamp: 1775312345678,
      version: 123456,
      values: {
        width: 640,
        height: 360,
        diff_threshold: 14,
        adaptive_k: 2.2,
        bg_learn_rate_fg: 0.002,
      },
    });
  });

  it('accepts version 0, the detector running its own config file', () => {
    const report = parseDetectorConfigLine('cfg,jean,1,0,diff_threshold=14');
    expect(report?.version).toBe(0);
  });

  it('skips a field that is not key=number', () => {
    const report = parseDetectorConfigLine(
      'cfg,jean,1,5,diff_threshold=abc,=3,novalue,morph_open=,min_blob_area=12',
    );
    expect(report?.values).toEqual({ min_blob_area: 12 });
  });

  it('rejects another line type, a short line and a bad version', () => {
    expect(parseDetectorConfigLine('stats,jean,12.5,240,1')).toBeNull();
    expect(parseDetectorConfigLine('cfg,jean,1')).toBeNull();
    expect(parseDetectorConfigLine('cfg,,1,5')).toBeNull();
    expect(parseDetectorConfigLine('cfg,jean,1,-2')).toBeNull();
    expect(parseDetectorConfigLine('cfg,jean,1,1.5')).toBeNull();
    expect(parseDetectorConfigLine('cfg,jean,x,5')).toBeNull();
  });
});
