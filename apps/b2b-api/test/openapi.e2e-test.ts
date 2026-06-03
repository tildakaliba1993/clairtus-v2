import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { buildOpenApiConfig } from '../src/openapi';

describe('OpenAPI document', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('generates a reference covering every key endpoint', () => {
    const doc = SwaggerModule.createDocument(app, buildOpenApiConfig());
    expect(doc.info.title).toContain('Clairtus');
    const paths = Object.keys(doc.paths);
    expect(paths).toEqual(expect.arrayContaining([
      '/v1/escrows',
      '/v1/escrows/{id}',
      '/v1/escrows/{id}/fund',
      '/v1/escrows/{id}/release',
      '/v1/escrows/{id}/refund',
      '/v1/parties',
      '/v1/payouts',
      '/v1/balances',
      '/v1/ledger',
      '/v1/kyc/checks',
      '/v1/kyc/callback',
      '/v1/webhook-endpoints',
    ]));
    // Bearer security scheme is declared.
    expect(doc.components?.securitySchemes).toHaveProperty('api-key');
  });
});
