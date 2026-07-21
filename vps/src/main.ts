import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsAdapter } from '@nestjs/platform-ws';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: '*',
    credentials: true,
  });
  app.useWebSocketAdapter(new WsAdapter(app));
  const host = process.env.HOST ?? '0.0.0.0';
  const port = process.env.PORT ?? 3000;
  await app.listen(port, host);
  console.log(`[HTTP] Serveur démarré sur http://${host}:${port}`);
}
bootstrap();
