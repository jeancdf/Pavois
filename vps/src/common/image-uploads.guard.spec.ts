import { NotFoundException } from '@nestjs/common';
import { ImageUploadsGuard, imageUploadsEnabled } from './image-uploads.guard';

describe('imageUploadsEnabled', () => {
  it('is off when the variable is missing', () => {
    expect(imageUploadsEnabled({})).toBe(false);
  });

  it('is off for anything but "true"', () => {
    expect(imageUploadsEnabled({ IMAGE_UPLOADS: '1' })).toBe(false);
    expect(imageUploadsEnabled({ IMAGE_UPLOADS: 'yes' })).toBe(false);
  });

  it('is on only for "true"', () => {
    expect(imageUploadsEnabled({ IMAGE_UPLOADS: 'true' })).toBe(true);
  });
});

describe('ImageUploadsGuard', () => {
  const previous = process.env.IMAGE_UPLOADS;

  afterEach(() => {
    if (previous === undefined) delete process.env.IMAGE_UPLOADS;
    else process.env.IMAGE_UPLOADS = previous;
  });

  it('answers 404 when uploads are off', () => {
    delete process.env.IMAGE_UPLOADS;
    expect(() => new ImageUploadsGuard().canActivate()).toThrow(
      NotFoundException,
    );
  });

  it('lets the request through when uploads are on', () => {
    process.env.IMAGE_UPLOADS = 'true';
    expect(new ImageUploadsGuard().canActivate()).toBe(true);
  });
});
