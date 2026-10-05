import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

export function imageUploadsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.IMAGE_UPLOADS === 'true';
}

@Injectable()
export class ImageUploadsGuard implements CanActivate {
  canActivate(): boolean {
    if (!imageUploadsEnabled()) {
      throw new NotFoundException();
    }
    return true;
  }
}
