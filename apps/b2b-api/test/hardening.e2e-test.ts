import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Tenancy, type SqlExecutor } from '@clairtus/tenancy';
import { AppModule } from '../src/app.module';
import { SQL } from '../src/db/sql';
import { applyAllSchema } from '../src/db/schema';
import { SCOPES, DEFAULT_WRITE_SCOPES } from '../src/common/scopes';

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
let fullKey: string; // all write scopes
let escrowOnlyKey: string; // escrows:write but NOT payouts:write
let noScopeKey: string; // valid key, no scopes

beforeAll(async () => {
  const db = new PGlite();
  const sql = executor(db);
  await applyAllSchema(sql);
  const tenancy = new Tenancy(sql);
  const t = await tenancy.createTenant({ name: 'Acme', country: 'ZA' });
  fullKey = (await tenancy.issueApiKey({ tenantId: t.id, mode: 'live', scopes: DEFAULT_WRITE_SCOPES })).plaintext;
  escrowOnlyKey = (await tenancy.issueApiKey({ tenantId: t.id, mode: 'live', scopes: [SCOPES.escrowsWrite] })).plaintext;
  noScopeKey = (await tenancy.issueApiKey({ tenantId: t.id, mode: 'live', scopes: [] })).plaintext;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL).useValue(sql)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
});

afterAll(async () => { await app.close(); });

const http = () => request(app.getHttpServer());
const validEscrow = { baseAmount: 100000, currency: 'ZAR', feeBps: 150, feeResponsibility: 'SELLER', sellerPartyId: randomUUID() };

describe('scope enforcement (PR-2.1)', () => {
  it('403 when the key lacks the route scope', async () => {
    const res = await http().post('/v1/escrows').set('Authorization', `Bearer ${noScopeKey}`).send(validEscrow);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    expect(res.body.error.message).toMatch(/escrows:write/);
  });

  it('403 is granular — an escrows:write key cannot create a payout (needs payouts:write)', async () => {
    const res = await http().post('/v1/payouts').set('Authorization', `Bearer ${escrowOnlyKey}`)
      .set('Idempotency-Key', randomUUID())
      .send({ escrowId: randomUUID(), recipientPartyId: randomUUID(), amount: 1000 });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/payouts:write/);
  });

  it('a key WITH the scope passes the scope gate', async () => {
    // Reaches the handler (escrow id is bogus → 404), proving the scope check let it through.
    const res = await http().post('/v1/escrows/00000000-0000-0000-0000-000000000000/fund')
      .set('Authorization', `Bearer ${fullKey}`).set('Idempotency-Key', randomUUID());
    expect(res.status).toBe(404);
  });
});

describe('required idempotency on money POSTs (PR-2.2)', () => {
  it('400 when Idempotency-Key is missing on a money route', async () => {
    const res = await http().post('/v1/escrows/00000000-0000-0000-0000-000000000000/fund')
      .set('Authorization', `Bearer ${fullKey}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
    expect(res.body.error.message).toMatch(/idempotency-key/i);
  });

  it('passes the idempotency gate when the key is present', async () => {
    const res = await http().post('/v1/escrows/00000000-0000-0000-0000-000000000000/fund')
      .set('Authorization', `Bearer ${fullKey}`).set('Idempotency-Key', randomUUID());
    expect(res.status).toBe(404); // reaches handler → escrow not found
  });

  it('escrow create succeeds WITHOUT an idempotency key (no money moves at create)', async () => {
    const seller = await http().post('/v1/parties').set('Authorization', `Bearer ${fullKey}`).send({ role: 'seller' });
    expect(seller.status).toBe(201);
    const res = await http().post('/v1/escrows').set('Authorization', `Bearer ${fullKey}`)
      .send({ ...validEscrow, sellerPartyId: seller.body.id });
    expect(res.status).toBe(201); // created with no Idempotency-Key header
  });
});

describe('input validation (PR-2.4)', () => {
  it('422 on a malformed body (negative amount)', async () => {
    const res = await http().post('/v1/escrows').set('Authorization', `Bearer ${fullKey}`)
      .send({ ...validEscrow, baseAmount: -5 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('unprocessable_entity');
  });

  it('422 on a missing required field (sellerPartyId)', async () => {
    const { sellerPartyId, ...noSeller } = validEscrow;
    const res = await http().post('/v1/escrows').set('Authorization', `Bearer ${fullKey}`).send(noSeller);
    expect(res.status).toBe(422);
  });

  it('422 on an unknown property (forbidNonWhitelisted)', async () => {
    const res = await http().post('/v1/escrows').set('Authorization', `Bearer ${fullKey}`)
      .send({ ...validEscrow, surprise: 'nope' });
    expect(res.status).toBe(422);
  });

  it('422 on a bad enum (feeResponsibility)', async () => {
    const res = await http().post('/v1/escrows').set('Authorization', `Bearer ${fullKey}`)
      .send({ ...validEscrow, feeResponsibility: 'WHOEVER' });
    expect(res.status).toBe(422);
  });
});

describe('malformed :id path params reject at the edge (400, not 500)', () => {
  const auth = () => ({ Authorization: `Bearer ${fullKey}` });
  const idem = () => ({ 'Idempotency-Key': randomUUID() });

  // Every :id route binds a `uuid` column; a non-UUID id must be a clean 400, never a 500 from a
  // Postgres "invalid input syntax for type uuid" cast error.
  it('GET escrow / party / payout / kyc-check with a non-UUID id → 400', async () => {
    for (const path of ['/v1/escrows/not-a-uuid', '/v1/parties/not-a-uuid', '/v1/payouts/not-a-uuid', '/v1/kyc/checks/not-a-uuid']) {
      const res = await http().get(path).set(auth());
      expect(res.status, path).toBe(400);
      expect(res.body.error.code, path).toBe('bad_request');
    }
  });

  it('escrow mutations with a non-UUID id → 400', async () => {
    for (const action of ['fund', 'release', 'refund']) {
      const res = await http().post(`/v1/escrows/not-a-uuid/${action}`).set(auth()).set(idem());
      expect(res.status, action).toBe(400);
    }
    for (const action of ['cancel', 'dispute']) {
      const res = await http().post(`/v1/escrows/not-a-uuid/${action}`).set(auth());
      expect(res.status, action).toBe(400);
    }
  });

  it('key revoke and webhook-delivery replay with a non-UUID id → 400', async () => {
    expect((await http().post('/v1/keys/undefined/revoke').set(auth())).status).toBe(400);
    expect((await http().post('/v1/webhook-deliveries/undefined/replay').set(auth())).status).toBe(400);
  });

  it('a valid (well-formed) but unknown UUID still 404s — not rejected by the format check', async () => {
    const res = await http().get(`/v1/escrows/${randomUUID()}`).set(auth());
    expect(res.status).toBe(404);
  });
});
