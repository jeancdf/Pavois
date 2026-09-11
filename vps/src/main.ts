import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsAdapter } from '@nestjs/platform-ws';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { applyBodyParsers } from './http-body';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  applyBodyParsers(app);

  // 1. En-têtes HTTP de sécurité (Helmet)
  app.use(helmet());

  // 2. Configuration CORS Stricte (pas d'origine '*')
  const rawOrigins = process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:8080,http://localhost:3000';
  const allowedOrigins = rawOrigins.split(',').map((o) => o.trim());

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`[CORS] Requête rejetée pour l'origine non autorisée : ${origin}`);
        callback(new Error('Origine non autorisée par la politique CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  // 3. Validation stricte des DTOs (Rejet des objets corrompus/champs non whitelistés)
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
  console.log(`[HTTP] Serveur NestJS Niveau 3 démarré sur http://${host}:${port}`);
}
bootstrap();
