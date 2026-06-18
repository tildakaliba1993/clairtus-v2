import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { type SqlExecutor } from '@clairtus/tenancy';
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

// "owner-jwt" → a user we'll provision a tenant for; "orphan-jwt" → a valid login with NO tenant yet.
const fakeVerifier: AuthVerifier = {
  async verify(token) {
    if (token === 'owner-jwt') return { userId: 'auth-owner', email: 'owner@acme.com' };
    if (token === 'orphan-jwt') return { userId: 'auth-orphan', email: 'orphan@acme.com' };
    return null;
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

  // Provision the owner's tenant (so tenant_users maps auth-owner → a tenant).
  await request(app.getHttpServer()).post('/v1/auth/signup').set('Authorization', 'Bearer owner-jwt');
});

afterAll(async () => { await app.close(); });

const http = () => request(app.getHttpServer());

describe('session-JWT authentication on business routes (B8 — login)', () => {
  it('a logged-in owner can READ tenant resources with just the session token (no API key)', async () => {
    const res = await http().get('/v1/escrows').set('Authorization', 'Bearer owner-jwt');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('a session owner can WRITE (has the owner scopes)', async () => {
    const res = await http().post('/v1/parties').set('Authorization', 'Bearer owner-jwt').send({ role: 'seller' });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/[0-9a-f-]{36}/);
  });

  it('session auth runs in TEST mode — a browser session never moves live money', async () => {
    // whoami echoes the resolved auth context; a session resolves to sandbox (test) mode.
    const res = await http().get('/v1/whoami').set('Authorization', 'Bearer owner-jwt');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('test');
  });

  it('a valid login with no provisioned tenant is rejected (must sign up first)', async () => {
    const res = await http().get('/v1/escrows').set('Authorization', 'Bearer orphan-jwt');
    expect(res.status).toBe(401);
  });

  it('an invalid/expired token is rejected (401)', async () => {
    expect((await http().get('/v1/escrows').set('Authorization', 'Bearer garbage')).status).toBe(401);
    expect((await http().get('/v1/escrows')).status).toBe(401);
  });

  it('does not grant operator scopes — /system/metrics still needs ops:read (403)', async () => {
    const res = await http().get('/v1/system/metrics').set('Authorization', 'Bearer owner-jwt');
    expect(res.status).toBe(403);
  });

  it('API-key auth still works alongside session auth', async () => {
    // Mint a key via the session, then authenticate a request with that key.
    const created = await http().post('/v1/keys').set('Authorization', 'Bearer owner-jwt').send({ mode: 'live', scopes: ['escrows:write'] });
    expect(created.status).toBe(201);
    const withKey = await http().get('/v1/escrows').set('Authorization', `Bearer ${created.body.plaintext}`);
    expect(withKey.status).toBe(200);
  });
});
