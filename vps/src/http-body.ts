import { INestApplication } from '@nestjs/common';
import { json, raw, urlencoded } from 'express';

/** Raw JPEG on POST /preview; JSON everywhere else. */
export function applyBodyParsers(app: INestApplication): void {
  app.use('/preview', raw({ type: '*/*', limit: '64kb' }));
  app.use('/api/preview', raw({ type: '*/*', limit: '64kb' }));
  app.use(json({ limit: '32kb' }));
  app.use(urlencoded({ extended: true }));
}
