import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Tenancy, type SqlExecutor } from '@clairtus/tenancy';
import type { PaymentRail } from '@clairtus/payments';
import { AppModule } from '../src/app.module';
import { DEFAULT_WRITE_SCOPES } from '../src/common/scopes';
import { SQL, RAIL } from '../src/db/sql';
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

// A fake LIVE Korapay-like rail: pay-in returns a virtual account, does NOT settle synchronously.
const initiatePayInCalls: { reference: string; amount: number }[] = [];
const liveRail: PaymentRail = {
  id: 'korapay',
  capabilities: { payIn: true, payOut: true, hold: true, countries: ['ZA'], currencies: ['ZAR'], methods: ['bank_transfer'] },
  async initiatePayIn(req) {
    initiatePayInCalls.push({ reference: req.reference, amount: req.amount });
    return { railRef: `kpy-${req.reference}`, status: 'pending', instructions: { type: 'virtual_account', value: '1234567890' } };
  },
  async initiatePayout(req) { return { railRef: req.reference, status: 'succeeded' }; },
  async getStatus(railRef) { return { railRef, status: 'pending' }; },
  parseWebhook() { return null; },
  verifyWebhook() { return true; },
};

let app: INestApplication;
let sql: SqlExecutor;
let liveAuth: string;
let testAuth: string;

beforeAll(async () => {
  const db = new PGlite();
  sql = executor(db);
  await applyAllSchema(sql);
  const tenancy = new Tenancy(sql);
  const t = await tenancy.createTenant({ name: 'Acme', country: 'ZA' });
  liveAuth = `Bearer ${(await tenancy.issueApiKey({ tenantId: t.id, mode: 'live', scopes: DEFAULT_WRITE_SCOPES })).plaintext}`;
  testAuth = `Bearer ${(await tenancy.issueApiKey({ tenantId: t.id, mode: 'test', scopes: DEFAULT_WRITE_SCOPES })).plaintext}`;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL).useValue(sql)
    .overrideProvider(RAIL).useValue(liveRail) // a live rail IS configured here
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
});

afterAll(async () => { await app.close(); });

const http = () => request(app.getHttpServer());
const idem = () => ({ 'Idempotency-Key': randomUUID() });

async function newEscrow(auth: string): Promise<string> {
  const seller = (await http().post('/v1/parties').set('Authorization', auth).send({ role: 'seller' })).body.id;
  return (await http().post('/v1/escrows').set('Authorization', auth)
    .send({ baseAmount: 100000, currency: 'ZAR', feeBps: 150, feeResponsibility: 'SELLER', sellerPartyId: seller })).body.id;
}

async function postingGroupCount(escrowId: string): Promise<number> {
  const r = await sql.query<{ n: number }>(`select count(*)::int as n from ledger_posting_groups where escrow_id = $1`, [escrowId]);
  return r.rows[0]!.n;
}

describe('real pay-in collection (PR-6.1 / 6.2)', () => {
  it('live-mode fund initiates a collection, returns instructions, and does NOT post to the ledger', async () => {
    const id = await newEscrow(liveAuth);
    const res = await http().post(`/v1/escrows/${id}/fund`).set('Authorization', liveAuth).set(idem());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('AWAITING_FUNDING'); // not FUNDED — funds haven't landed
    expect(res.body.payment).toMatchObject({ rail: 'korapay', status: 'pending', instructions: { type: 'virtual_account', value: '1234567890' } });
    expect(res.body.payment.railRef).toBe(`kpy-payin:${id}`);

    // The rail was actually called, a payin intent was persisted, and NOTHING posted to the ledger.
    expect(initiatePayInCalls.some((c) => c.reference === `payin:${id}`)).toBe(true);
    const payins = await sql.query<{ status: string; rail_ref: string }>(`select status, rail_ref from payins where escrow_id = $1`, [id]);
    expect(payins.rows).toHaveLength(1);
    expect(payins.rows[0]!.status).toBe('pending');
    expect(await postingGroupCount(id)).toBe(0);
  });

  it('test-mode fund still settles synchronously (sandbox parity)', async () => {
    const id = await newEscrow(testAuth);
    const res = await http().post(`/v1/escrows/${id}/fund`).set('Authorization', testAuth).set(idem());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FUNDED');
    expect(res.body.depositAmount).toBeGreaterThan(0);
    expect(await postingGroupCount(id)).toBeGreaterThan(0); // posted into held
    const payins = await sql.query<{ n: number }>(`select count(*)::int as n from payins where escrow_id = $1`, [id]);
    expect(payins.rows[0]!.n).toBe(0); // no rail collection in sandbox
  });
});
