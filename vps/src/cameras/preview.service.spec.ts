import { EventsGateway } from '../realtime/events.gateway';
import { PreviewService } from './preview.service';

describe('PreviewService', () => {
  const gateway = { broadcast: jest.fn() };
  const service = new PreviewService(
    gateway as unknown as EventsGateway,
  );

  beforeEach(() => {
    gateway.broadcast.mockClear();
  });

  it('broadcasts a jpeg thumbnail', () => {
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(service.ingest('jean', jpeg)).toBe(true);
    expect(gateway.broadcast).toHaveBeenCalledWith(
      'camera_preview',
      expect.objectContaining({
        cameraId: 'jean',
        mime: 'image/jpeg',
      }),
    );
  });

  it('rejects a buffer that is not jpeg', () => {
    expect(service.ingest('jean', Buffer.from('not-a-jpeg!!'))).toBe(
      false,
    );
    expect(gateway.broadcast).not.toHaveBeenCalled();
  });

  it('rejects an invented camera id', () => {
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(service.ingest('jean/../x', jpeg)).toBe(false);
  });
});
