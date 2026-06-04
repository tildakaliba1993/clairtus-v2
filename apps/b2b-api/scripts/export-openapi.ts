import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import { AppModule } from '../src/app.module';
import { buildOpenApiConfig } from '../src/openapi';

/**
 * Exports the OpenAPI document to a JSON file (default openapi.json) without starting the server.
 * Feed it to a static docs site (Redoc / Swagger UI) for developers.clairtus.com, or commit it as
 * an artifact. No DB needed — the doc is generated from decorators/DTOs.
 *
 *   corepack pnpm --filter @clairtus/b2b-api openapi:export [outfile]
 */
async function main(): Promise<void> {
  const out = process.argv[2] ?? 'openapi.json';
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('v1');
  const doc = SwaggerModule.createDocument(app, buildOpenApiConfig());
  writeFileSync(out, JSON.stringify(doc, null, 2));
  await app.close();
  // eslint-disable-next-line no-console
  console.log(`OpenAPI written to ${out} (${Object.keys(doc.paths).length} paths)`);
}

void main();
