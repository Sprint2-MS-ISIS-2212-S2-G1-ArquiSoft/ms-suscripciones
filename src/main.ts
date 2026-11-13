import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);

  // Detras del ALB / balanceador interno (idle timeout de 60 s) el keep-alive
  // de Node tiene que ser mayor para evitar 502 esporadicos bajo carga.
  const servidor = app.getHttpServer() as Server;
  servidor.keepAliveTimeout = 65_000;
  servidor.headersTimeout = 66_000;
}
void bootstrap();
