import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { correlationMiddleware } from '../src/common/correlation';

describe('correlation id middleware', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(correlationMiddleware);
    app.setGlobalPrefix('v1');
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('echoes a provided X-Request-Id', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health').set('X-Request-Id', 'req-abc-123');
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe('req-abc-123');
  });

  it('generates a request id when none is supplied', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
