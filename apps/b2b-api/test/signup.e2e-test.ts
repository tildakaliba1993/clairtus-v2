import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { Tenancy, type SqlExecutor } from '@clairtus/tenancy';
import { AppModule } from '../src/app.module';
import { SQL } from '../src/db/sql';
import { AUTH_VERIFIER, type AuthVerifier } from '../src/auth/session';
import { applyAllSchema } from '../src/db/schema';

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

// Fake session verifier: "good-jwt" → a fixed user; anything else → invalid.
const fakeVerifier: AuthVerifier = {
  async verify(token) {
    return token === 'good-jwt' ? { userId: 'auth-user-1', email: 'partner@acme.com' } : null;
  },
};

let app: INestApplication;

beforeAll(async () => {
  const db = new PGlite();
  const sql = executor(db);
  await applyAllSchema(sql);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL).useValue(sql)
    .overrideProvider(AUTH_VERIFIER).useValue(fakeVerifier)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
});

afterAll(async () => { await app.close(); });

const http = () => request(app.getHttpServer());

describe('self-serve signup (P3.2)', () => {
  it('provisions a tenant + keys on first signup; the keys actually work', async () => {
    const res = await http().post('/v1/auth/signup').set('Authorization', 'Bearer good-jwt');
    expect(res.status).toBe(200);
    expect(res.body.provisioned).toBe(true);
    expect(res.body.tenantId).toMatch(/[0-9a-f-]{36}/);
    expect(res.body.testKey.startsWith('ck_test_')).toBe(true);
    expect(res.body.liveKey.startsWith('ck_live_')).toBe(true);

    // The freshly issued key is fully functional (has the default scopes, incl. keys:read).
    const keys = await http().get('/v1/keys').set('Authorization', `Bearer ${res.body.testKey}`);
    expect(keys.status).toBe(200);
    expect(keys.body.length).toBe(2); // test + live
  });

  it('is idempotent — a returning user gets their tenant, no new keys leaked', async () => {
    const res = await http().post('/v1/auth/signup').set('Authorization', 'Bearer good-jwt');
    expect(res.status).toBe(200);
    expect(res.body.provisioned).toBe(false);
    expect(res.body.testKey).toBeUndefined();
    expect(res.body.liveKey).toBeUndefined();
  });

  it('GET /auth/me returns the tenant + key metadata for the session', async () => {
    const res = await http().get('/v1/auth/me').set('Authorization', 'Bearer good-jwt');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('partner@acme.com');
    expect(res.body.keys.length).toBe(2);
    expect(JSON.stringify(res.body)).not.toMatch(/plaintext|hash|ck_test_|ck_live_/);
  });

  it('rejects a missing or invalid session token (401)', async () => {
    expect((await http().post('/v1/auth/signup')).status).toBe(401);
    expect((await http().post('/v1/auth/signup').set('Authorization', 'Bearer nope')).status).toBe(401);
    expect((await http().get('/v1/auth/me').set('Authorization', 'Bearer nope')).status).toBe(401);
  });
});
