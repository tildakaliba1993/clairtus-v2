import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildOpenApiConfig } from './openapi';
import { correlationMiddleware } from './common/correlation';

// Production bootstrap. The DB/rail/KYC providers are env-driven (see app.module): set
// DATABASE_URL (Postgres) + run `pnpm migrate` before serving money endpoints.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.use(correlationMiddleware); // correlation id + structured-log context per request
  app.enableShutdownHooks(); // clean SIGTERM handling (Fly/Render rolling deploys)
  app.setGlobalPrefix('v1');
  // Interactive API reference at /docs (OpenAPI JSON at /docs-json).
  const doc = SwaggerModule.createDocument(app, buildOpenApiConfig());
  SwaggerModule.setup('docs', app, doc);
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000, '0.0.0.0');
}

void bootstrap();
