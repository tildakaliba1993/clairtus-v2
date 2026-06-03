import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildOpenApiConfig } from './openapi';

// Production bootstrap. NOTE: a Postgres SqlExecutor must be wired in (override the SQL
// provider) before money endpoints work — the default throws. Tracked for T3.3 deploy.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  // Interactive API reference at /docs (OpenAPI JSON at /docs-json).
  const doc = SwaggerModule.createDocument(app, buildOpenApiConfig());
  SwaggerModule.setup('docs', app, doc);
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();
