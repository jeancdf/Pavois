import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { applyBodyParsers } from './common/http-body';
import { assertAuthTokenConfigured } from './auth/access-control';
import { readSharedSecret } from './common/message-auth';

const DEV_ORIGINS =
  'http://localhost:4200,http://localhost:5173,http://localhost:8080,http://localhost:3000';

process.on('unhandledRejection', (reason) => {
  console.error('[PROCESS] Promesse rejetée non gérée :', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[PROCESS] Exception non gérée, arrêt :', error);
  process.exit(1);
});

async function bootstrap() {
  try {
    assertAuthTokenConfigured();
    readSharedSecret();
  } catch (error) {
    console.error(`[BOOT] ${(error as Error).message}`);
    process.exit(1);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.set('trust proxy', 'loopback, uniquelocal');
  applyBodyParsers(app);
  app.use(helmet());

  const production = process.env.NODE_ENV === 'production';
  const fallbackOrigins = production ? '' : DEV_ORIGINS;
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || fallbackOrigins)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`[CORS] Origine refusée : ${origin}`);
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useWebSocketAdapter(new WsAdapter(app));
  const host = process.env.HOST ?? '0.0.0.0';
  const port = process.env.PORT ?? 3002;
  await app.listen(port, host);
  console.log(`[HTTP] Serveur démarré sur http://${host}:${port}`);
}
void bootstrap();
