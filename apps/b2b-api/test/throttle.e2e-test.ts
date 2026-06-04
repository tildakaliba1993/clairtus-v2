import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { Tenancy, type SqlExecutor } from '@clairtus/tenancy';
import { SQL } from '../src/db/sql';

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

const LIMIT = 3;
let app: INestApplication;
let auth: string;

beforeAll(async () => {
  // Set the throttle limit BEFORE importing AppModule, so ThrottlerModule.forRoot picks it up.
  process.env.THROTTLE_LIMIT = String(LIMIT);
  process.env.THROTTLE_TTL = '60000';
  const { AppModule } = await import('../src/app.module');

  const db = new PGlite();
  const sql = executor(db);
  const tenancy = new Tenancy(sql);
  await tenancy.init();
  const t = await tenancy.createTenant({ name: 'Acme', country: 'ZA' });
  auth = `Bearer ${(await tenancy.issueApiKey({ tenantId: t.id, mode: 'live', scopes: [] })).plaintext}`;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL).useValue(sql)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
});

afterAll(async () => {
  await app.close();
  delete process.env.THROTTLE_LIMIT;
  delete process.env.THROTTLE_TTL;
});

const http = () => request(app.getHttpServer());

describe('rate limiting per API key (PR-2.3)', () => {
  it(`allows up to the limit then returns 429`, async () => {
    const statuses: number[] = [];
    for (let i = 0; i < LIMIT + 1; i++) {
      const res = await http().get('/v1/whoami').set('Authorization', auth);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, LIMIT).every((s) => s === 200)).toBe(true);
    expect(statuses[LIMIT]).toBe(429);
  });
});
