import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { Tenancy, type SqlExecutor } from '@clairtus/tenancy';
import { AppModule } from '../src/app.module';
import { SQL, IDEMPOTENCY_SCHEMA } from '../src/db/sql';

function executor(db: PGlite): SqlExecutor {
  return {
    async query(sql, params) {
      const r = await db.query(sql, params as never);
      return { rows: r.rows as never[] };
    },
    async transaction(fn) {
      return db.transaction(async (tx) =>
        fn({
          async query(sql, params) {
            const r = await tx.query(sql, params as never);
            return { rows: r.rows as never[] };
          },
          transaction() { throw new Error('nested'); },
        }),
      ) as never;
    },
  };
}

let app: INestApplication;
let apiKey: string; // valid live key plaintext
let revokedKey: string;
let tenantId: string;

beforeAll(async () => {
  const db = new PGlite();
  const sql = executor(db);

  // Seed schema + a tenant + keys against the SAME executor the app will use.
  const tenancy = new Tenancy(sql);
  await tenancy.init();
  await db.exec(IDEMPOTENCY_SCHEMA);
  tenantId = (await tenancy.createTenant({ name: 'Acme', country: 'ZA' })).id;
  apiKey = (await tenancy.issueApiKey({ tenantId, mode: 'live', scopes: ['escrows:write'] })).plaintext;
  const rk = await tenancy.issueApiKey({ tenantId, mode: 'test', scopes: [] });
  revokedKey = rk.plaintext;
  await tenancy.revokeApiKey(rk.id);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL)
    .useValue(sql)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
});

afterAll(async () => {
  await app.close();
});

const http = () => request(app.getHttpServer());

describe('health (public)', () => {
  it('GET /v1/health needs no key', async () => {
    const res = await http().get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('API-key auth guard', () => {
  it('401 with no key, in the error envelope', async () => {
    const res = await http().get('/v1/whoami');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'unauthorized', message: 'Missing API key', statusCode: 401 } });
  });

  it('401 with an unknown key', async () => {
    const res = await http().get('/v1/whoami').set('Authorization', 'Bearer ck_live_garbage');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/invalid or revoked/i);
  });

  it('401 with a revoked key', async () => {
    const res = await http().get('/v1/whoami').set('Authorization', `Bearer ${revokedKey}`);
    expect(res.status).toBe(401);
  });

  it('200 with a valid key → returns the tenant context', async () => {
    const res = await http().get('/v1/whoami').set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tenantId, mode: 'live', scopes: ['escrows:write'] });
  });
});

describe('idempotency (invariant #3)', () => {
  it('replaying the same Idempotency-Key returns the cached response (handler not re-run)', async () => {
    const auth = `Bearer ${apiKey}`;
    const key = 'idem-key-001';
    const first = await http().post('/v1/echo').set('Authorization', auth).set('Idempotency-Key', key).send({ a: 1 });
    const second = await http().post('/v1/echo').set('Authorization', auth).set('Idempotency-Key', key).send({ a: 1 });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(second.body.id).toBe(first.body.id); // same id → response was cached, not regenerated
  });

  it('reusing a key with a different body is a 409 conflict', async () => {
    const auth = `Bearer ${apiKey}`;
    const key = 'idem-key-002';
    await http().post('/v1/echo').set('Authorization', auth).set('Idempotency-Key', key).send({ a: 1 });
    const conflict = await http().post('/v1/echo').set('Authorization', auth).set('Idempotency-Key', key).send({ a: 999 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('conflict');
  });

  it('without an Idempotency-Key, each call is independent', async () => {
    const auth = `Bearer ${apiKey}`;
    const r1 = await http().post('/v1/echo').set('Authorization', auth).send({ a: 1 });
    const r2 = await http().post('/v1/echo').set('Authorization', auth).send({ a: 1 });
    expect(r1.body.id).not.toBe(r2.body.id);
  });
});
