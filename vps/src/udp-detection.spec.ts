import { parseRawDetectionLine } from './udp-detection';

describe('udp raw detection packets', () => {
  it('parses a legacy 8-field raw line without pose/intrinsics', () => {
    const parsed = parseRawDetectionLine(
      'raw,jean,12,1000,320.5,180.2,45,0.87',
    );
    expect(parsed).toEqual({
      cameraId: 'jean',
      frameIndex: 12,
      timestamp: 1000,
      x: 320.5,
      y: 180.2,
      size: 45,
      confidence: 0.87,
    });
  });

  it('parses an extended raw line carrying the frame pose and intrinsics', () => {
    const parsed = parseRawDetectionLine(
      'raw,jean,12,1000,320.5,180.2,45,0.87,164.2,-1.5,0.3,65,1280,720',
    );
    expect(parsed).toEqual({
      cameraId: 'jean',
      frameIndex: 12,
      timestamp: 1000,
      x: 320.5,
      y: 180.2,
      size: 45,
      confidence: 0.87,
      headingDeg: 164.2,
      elevationDeg: -1.5,
      rollDeg: 0.3,
      fovDeg: 65,
      imageWidth: 1280,
      imageHeight: 720,
    });
  });

  it('rejects invented tokens that are not raw packets', () => {
    expect(parseRawDetectionLine('att,jean,164.2,-1.5,0.3,1000')).toBeNull();
    expect(parseRawDetectionLine('raw,jean,1,0,1,1,1')).toBeNull();
  });

  it('drops the trailing fields instead of erroring on a malformed extension', () => {
    const parsed = parseRawDetectionLine(
      'raw,jean,12,1000,320.5,180.2,45,0.87,not-a-number,-1.5,0.3,65,1280,720',
    );
    expect(parsed).toEqual({
      cameraId: 'jean',
      frameIndex: 12,
      timestamp: 1000,
      x: 320.5,
      y: 180.2,
      size: 45,
      confidence: 0.87,
    });
  });
});
