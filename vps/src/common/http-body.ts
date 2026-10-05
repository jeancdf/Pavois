import { INestApplication } from '@nestjs/common';
import { json, raw, urlencoded } from 'express';

/** Raw JPEG on preview/classification endpoints; JSON everywhere else. */
export function applyBodyParsers(app: INestApplication): void {
  app.use('/preview', raw({ type: '*/*', limit: '64kb' }));
  app.use('/api/preview', raw({ type: '*/*', limit: '64kb' }));
  app.use('/classification/capture', raw({ type: '*/*', limit: '1mb' }));
  app.use('/api/classification/capture', raw({ type: '*/*', limit: '1mb' }));
  app.use(json({ limit: '32kb' }));
  app.use(urlencoded({ extended: true, limit: '32kb' }));
}
