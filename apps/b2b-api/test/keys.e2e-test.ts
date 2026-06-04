import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { Tenancy, type SqlExecutor } from '@clairtus/tenancy';
import { AppModule } from '../src/app.module';
import { DEFAULT_WRITE_SCOPES } from '../src/common/scopes';
import { SQL } from '../src/db/sql';
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

let app: INestApplication;
let tenancy: Tenancy;
let adminAuth: string; // key with keys:read + keys:write
let aTenantId: string;

beforeAll(async () => {
  const db = new PGlite();
  const sql = executor(db);
  await applyAllSchema(sql);
  tenancy = new Tenancy(sql);
  const a = await tenancy.createTenant({ name: 'Acme', country: 'ZA' });
  aTenantId = a.id;
  adminAuth = `Bearer ${(await tenancy.issueApiKey({ tenantId: a.id, mode: 'live', scopes: DEFAULT_WRITE_SCOPES })).plaintext}`;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL).useValue(sql)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
});

afterAll(async () => { await app.close(); });

const http = () => request(app.getHttpServer());

describe('API-key management (P3.1)', () => {
  it('lists the tenant keys (metadata only, no plaintext/hash)', async () => {
    const res = await http().get('/v1/keys').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toHaveProperty('last4');
    expect(res.body[0]).toHaveProperty('active', true);
    expect(JSON.stringify(res.body)).not.toMatch(/plaintext|hash/);
  });

  it('creates a key (plaintext returned ONCE) that then authenticates', async () => {
    const res = await http().post('/v1/keys').set('Authorization', adminAuth).send({ mode: 'test', scopes: ['escrows:write'] });
    expect(res.status).toBe(201);
    expect(res.body.plaintext.startsWith('ck_test_')).toBe(true);
    expect(res.body.last4).toBe(res.body.plaintext.slice(-4));

    const authed = await tenancy.authenticate(res.body.plaintext);
    expect(authed).toMatchObject({ tenantId: aTenantId, mode: 'test', scopes: ['escrows:write'] });
  });

  it('a minted narrow key cannot manage keys (missing keys:read/write → 403)', async () => {
    const minted = (await http().post('/v1/keys').set('Authorization', adminAuth).send({ mode: 'test', scopes: ['escrows:write'] })).body.plaintext;
    const res = await http().get('/v1/keys').set('Authorization', `Bearer ${minted}`);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/keys:read/);
  });

  it('revokes a key — it stops authenticating and shows inactive', async () => {
    const created = (await http().post('/v1/keys').set('Authorization', adminAuth).send({ mode: 'test' })).body;
    expect(await tenancy.authenticate(created.plaintext)).not.toBeNull();

    const res = await http().post(`/v1/keys/${created.id}/revoke`).set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(await tenancy.authenticate(created.plaintext)).toBeNull();

    const list = await http().get('/v1/keys').set('Authorization', adminAuth);
    expect(list.body.find((k: { id: string }) => k.id === created.id).active).toBe(false);
  });

  it('cannot revoke another tenant\'s key (404)', async () => {
    const b = await tenancy.createTenant({ name: 'Beta', country: 'ZA' });
    const bAdmin = `Bearer ${(await tenancy.issueApiKey({ tenantId: b.id, mode: 'live', scopes: DEFAULT_WRITE_SCOPES })).plaintext}`;
    const aKey = (await http().post('/v1/keys').set('Authorization', adminAuth).send({ mode: 'test' })).body;

    const res = await http().post(`/v1/keys/${aKey.id}/revoke`).set('Authorization', bAdmin);
    expect(res.status).toBe(404);
    expect(await tenancy.authenticate(aKey.plaintext)).not.toBeNull(); // untouched
  });
});
