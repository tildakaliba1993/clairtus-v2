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

// Sandbox lifecycle test: test-mode keys → synchronous funding + the built-in SimulatedRail for payout.
// (The live, webhook-driven funding path is covered in payin.e2e + webhook.e2e.)
let app: INestApplication;
let keyA: string;
let keyB: string;

const authA = () => `Bearer ${keyA}`;
const authB = () => `Bearer ${keyB}`;

beforeAll(async () => {
  const db = new PGlite();
  const sql = executor(db);
  await applyAllSchema(sql);

  const tenancy = new Tenancy(sql);
  const a = await tenancy.createTenant({ name: 'A', country: 'ZA' });
  const b = await tenancy.createTenant({ name: 'B', country: 'ZA' });
  keyA = (await tenancy.issueApiKey({ tenantId: a.id, mode: 'test', scopes: DEFAULT_WRITE_SCOPES })).plaintext;
  keyB = (await tenancy.issueApiKey({ tenantId: b.id, mode: 'test', scopes: DEFAULT_WRITE_SCOPES })).plaintext;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL).useValue(sql)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
});

afterAll(async () => { await app.close(); });

const http = () => request(app.getHttpServer());
const balOf = (body: { data: { type: string; ownerRef: string | null; balance: number }[] }, type: string, owner?: string) =>
  body.data.find((a) => a.type === type && (owner === undefined || a.ownerRef === owner))?.balance ?? 0;

describe('full escrow lifecycle via API (SELLER fee)', () => {
  it('create parties → escrow → fund → release → payout, balances reconcile to zero', async () => {
    const seller = (await http().post('/v1/parties').set('Authorization', authA()).send({ role: 'seller', name: 'Sue', accountRef: '0000000000', bankCode: '033' })).body;
    const buyer = (await http().post('/v1/parties').set('Authorization', authA()).send({ role: 'buyer', name: 'Bob' })).body;

    const created = await http().post('/v1/escrows').set('Authorization', authA()).send({
      baseAmount: 100000, currency: 'ZAR', feeBps: 150, feeResponsibility: 'SELLER',
      buyerPartyId: buyer.id, sellerPartyId: seller.id,
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('DRAFT');
    const escrowId = created.body.id;

    const funded = await http().post(`/v1/escrows/${escrowId}/fund`).set('Authorization', authA()).set('Idempotency-Key', randomUUID());
    expect(funded.status).toBe(200);
    expect(funded.body.status).toBe('FUNDED');
    expect(funded.body.depositAmount).toBe(100000); // SELLER pays base only

    let balances = (await http().get('/v1/balances').set('Authorization', authA())).body;
    expect(balOf(balances, 'escrow_held')).toBe(100000);

    const released = await http().post(`/v1/escrows/${escrowId}/release`).set('Authorization', authA()).set('Idempotency-Key', randomUUID());
    expect(released.status).toBe(200);
    expect(released.body.status).toBe('RELEASED');

    balances = (await http().get('/v1/balances').set('Authorization', authA())).body;
    expect(balOf(balances, 'escrow_held')).toBe(0);
    expect(balOf(balances, 'recipient_payable', seller.id)).toBe(98500);
    expect(balOf(balances, 'clairtus_revenue')).toBe(1500);

    const payout = await http().post('/v1/payouts').set('Authorization', authA()).set('Idempotency-Key', randomUUID())
      .send({ escrowId, recipientPartyId: seller.id, amount: 98500 });
    expect(payout.status).toBe(201);
    expect(payout.body).toMatchObject({ status: 'succeeded', rail: 'simulated', railRef: `sim_po_${payout.body.id}` });

    balances = (await http().get('/v1/balances').set('Authorization', authA())).body;
    expect(balOf(balances, 'recipient_payable', seller.id)).toBe(0);
    expect(balOf(balances, 'clairtus_revenue')).toBe(1500);
    expect(balOf(balances, 'external')).toBe(-1500);
    // Conservation: every account balance sums to zero.
    expect(balances.data.reduce((s: number, a: { balance: number }) => s + a.balance, 0)).toBe(0);

    const ledger = (await http().get('/v1/ledger').set('Authorization', authA())).body;
    expect(ledger.data.length).toBeGreaterThan(0);
    expect(ledger.data.some((e: { reference: string }) => e.reference === `payout:${payout.body.id}`)).toBe(true);
  });
});

describe('refund path', () => {
  it('fund → refund returns the deposit to external and ends REFUNDED', async () => {
    const seller = (await http().post('/v1/parties').set('Authorization', authA()).send({ role: 'seller' })).body;
    const escrowId = (await http().post('/v1/escrows').set('Authorization', authA()).send({
      baseAmount: 50000, currency: 'ZAR', feeBps: 0, feeResponsibility: 'SELLER', sellerPartyId: seller.id,
    })).body.id;
    await http().post(`/v1/escrows/${escrowId}/fund`).set('Authorization', authA()).set('Idempotency-Key', randomUUID());
    const refunded = await http().post(`/v1/escrows/${escrowId}/refund`).set('Authorization', authA()).set('Idempotency-Key', randomUUID());
    expect(refunded.status).toBe(200);
    expect(refunded.body.status).toBe('REFUNDED');
    const e = await http().get(`/v1/escrows/${escrowId}`).set('Authorization', authA());
    expect(e.body.status).toBe('REFUNDED');
  });
});

describe('guards & invariants', () => {
  it('tenant B cannot read tenant A\'s escrow (404)', async () => {
    const seller = (await http().post('/v1/parties').set('Authorization', authA()).send({ role: 'seller' })).body;
    const escrowId = (await http().post('/v1/escrows').set('Authorization', authA()).send({
      baseAmount: 1000, currency: 'ZAR', feeBps: 0, feeResponsibility: 'SELLER', sellerPartyId: seller.id,
    })).body.id;
    const asB = await http().get(`/v1/escrows/${escrowId}`).set('Authorization', authB());
    expect(asB.status).toBe(404);
  });

  it('illegal transition (release before fund) → 409', async () => {
    const seller = (await http().post('/v1/parties').set('Authorization', authA()).send({ role: 'seller' })).body;
    const escrowId = (await http().post('/v1/escrows').set('Authorization', authA()).send({
      baseAmount: 1000, currency: 'ZAR', feeBps: 0, feeResponsibility: 'SELLER', sellerPartyId: seller.id,
    })).body.id;
    const res = await http().post(`/v1/escrows/${escrowId}/release`).set('Authorization', authA()).set('Idempotency-Key', randomUUID());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('over-payout (more than owed) → 422', async () => {
    const seller = (await http().post('/v1/parties').set('Authorization', authA()).send({ role: 'seller' })).body;
    const escrowId = (await http().post('/v1/escrows').set('Authorization', authA()).send({
      baseAmount: 1000, currency: 'ZAR', feeBps: 0, feeResponsibility: 'SELLER', sellerPartyId: seller.id,
    })).body.id;
    await http().post(`/v1/escrows/${escrowId}/fund`).set('Authorization', authA()).set('Idempotency-Key', randomUUID());
    // Nothing released yet → recipient is owed 0.
    const res = await http().post('/v1/payouts').set('Authorization', authA()).set('Idempotency-Key', randomUUID())
      .send({ escrowId, recipientPartyId: seller.id, amount: 500 });
    expect(res.status).toBe(422);
  });
});
