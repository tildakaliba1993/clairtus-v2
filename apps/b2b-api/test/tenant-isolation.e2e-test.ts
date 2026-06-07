import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
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
let sql: SqlExecutor;
let aAuth: string; // tenant A admin key
let bAuth: string; // tenant B admin key
let aTenantId: string;

// Tenant A's resources (created/seeded below) — tenant B must NOT be able to touch any of them.
let aEscrowId: string;
let aPartyId: string;
let aPayoutId: string;
let aKeyId: string;

beforeAll(async () => {
  const db = new PGlite();
  sql = executor(db);
  await applyAllSchema(sql);
  const tenancy = new Tenancy(sql);

  const a = await tenancy.createTenant({ name: 'Acme', country: 'ZA' });
  const b = await tenancy.createTenant({ name: 'Globex', country: 'ZA' });
  aTenantId = a.id;
  aAuth = `Bearer ${(await tenancy.issueApiKey({ tenantId: a.id, mode: 'live', scopes: DEFAULT_WRITE_SCOPES })).plaintext}`;
  bAuth = `Bearer ${(await tenancy.issueApiKey({ tenantId: b.id, mode: 'live', scopes: DEFAULT_WRITE_SCOPES })).plaintext}`;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL).useValue(sql)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();

  const http = () => request(app.getHttpServer());
  // Tenant A builds a party + funded escrow (→ balances + ledger entries) and an API key.
  aPartyId = (await http().post('/v1/parties').set('Authorization', aAuth).send({ role: 'seller' })).body.id;
  aEscrowId = (await http().post('/v1/escrows').set('Authorization', aAuth)
    .send({ baseAmount: 100000, currency: 'ZAR', feeBps: 150, feeResponsibility: 'SELLER', sellerPartyId: aPartyId })).body.id;
  await http().post(`/v1/escrows/${aEscrowId}/fund`).set('Authorization', aAuth).set('Idempotency-Key', randomUUID());
  aKeyId = (await http().post('/v1/keys').set('Authorization', aAuth).send({ mode: 'test', scopes: ['escrows:write'] })).body.id;

  // Seed a payout row for tenant A directly (the creation path is covered elsewhere).
  aPayoutId = randomUUID();
  await sql.query(
    `insert into payouts (id, tenant_id, escrow_id, recipient_party_id, amount, currency, status)
     values ($1,$2,$3,$4,5000,'ZAR','pending')`,
    [aPayoutId, aTenantId, aEscrowId, aPartyId],
  );
});

afterAll(async () => { await app.close(); });

const http = () => request(app.getHttpServer());

/**
 * A4 backstop: with the API connecting as the table owner, tenant isolation rests entirely on the
 * service layer's `where tenant_id` filters — one missed filter is a cross-tenant leak. These tests
 * assert every read/mutate endpoint is tenant-scoped, so a regression is caught in CI.
 * (Enforcing Postgres RLS by running under a non-owner role with `app.current_tenant` per request is
 * the stronger, ops-gated follow-up — it needs a non-owner DB role provisioned on Supabase.)
 */
describe('cross-tenant isolation (A4 backstop)', () => {
  it('tenant B cannot READ tenant A resources by id (404)', async () => {
    expect((await http().get(`/v1/escrows/${aEscrowId}`).set('Authorization', bAuth)).status).toBe(404);
    expect((await http().get(`/v1/parties/${aPartyId}`).set('Authorization', bAuth)).status).toBe(404);
    expect((await http().get(`/v1/payouts/${aPayoutId}`).set('Authorization', bAuth)).status).toBe(404);
  });

  it('tenant B cannot MUTATE tenant A escrows (404 — escrow not in B\'s tenant)', async () => {
    const idem = () => ({ 'Idempotency-Key': randomUUID() });
    expect((await http().post(`/v1/escrows/${aEscrowId}/fund`).set('Authorization', bAuth).set(idem())).status).toBe(404);
    expect((await http().post(`/v1/escrows/${aEscrowId}/release`).set('Authorization', bAuth).set(idem())).status).toBe(404);
    expect((await http().post(`/v1/escrows/${aEscrowId}/refund`).set('Authorization', bAuth).set(idem())).status).toBe(404);
    expect((await http().post(`/v1/escrows/${aEscrowId}/cancel`).set('Authorization', bAuth)).status).toBe(404);
    expect((await http().post(`/v1/escrows/${aEscrowId}/dispute`).set('Authorization', bAuth)).status).toBe(404);
  });

  it('tenant B cannot revoke tenant A keys (404)', async () => {
    expect((await http().post(`/v1/keys/${aKeyId}/revoke`).set('Authorization', bAuth)).status).toBe(404);
  });

  it('tenant B LIST/aggregate views never include tenant A data', async () => {
    const escrows = (await http().get('/v1/escrows').set('Authorization', bAuth)).body.data as { id: string }[];
    expect(escrows.find((e) => e.id === aEscrowId)).toBeUndefined();
    expect(escrows).toHaveLength(0);

    const payouts = (await http().get('/v1/payouts').set('Authorization', bAuth)).body.data as { id: string }[];
    expect(payouts.find((p) => p.id === aPayoutId)).toBeUndefined();

    // B created no money movements → no ledger accounts/entries leak from A.
    const balances = (await http().get('/v1/balances').set('Authorization', bAuth)).body.data as unknown[];
    expect(balances).toHaveLength(0);
    const ledger = (await http().get('/v1/ledger').set('Authorization', bAuth)).body.data as unknown[];
    expect(ledger).toHaveLength(0);
  });

  it('tenant A can still access its own resources (control)', async () => {
    expect((await http().get(`/v1/escrows/${aEscrowId}`).set('Authorization', aAuth)).status).toBe(200);
    expect((await http().get(`/v1/parties/${aPartyId}`).set('Authorization', aAuth)).status).toBe(200);
    expect((await http().get(`/v1/payouts/${aPayoutId}`).set('Authorization', aAuth)).status).toBe(200);
    const balances = (await http().get('/v1/balances').set('Authorization', aAuth)).body.data as unknown[];
    expect(balances.length).toBeGreaterThan(0);
  });
});
