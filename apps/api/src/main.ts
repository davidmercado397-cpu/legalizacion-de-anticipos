import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { cargarConfiguracion } from './shared/configuracion';

async function bootstrap(): Promise<void> {
  const configuracion = cargarConfiguracion();
  const app = await NestFactory.create(AppModule.forRoot(configuracion));
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: configuracion.CORS_ORIGINS.split(',').map((o) => o.trim()) });
  app.enableShutdownHooks();
  await app.listen(configuracion.PORT);
  Logger.log(`API en http://localhost:${configuracion.PORT}/api/v1 (auth: ${configuracion.AUTH_MODE})`, 'Bootstrap');
}

void bootstrap();
