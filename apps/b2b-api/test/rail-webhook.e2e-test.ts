import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Tenancy, type SqlExecutor } from '@clairtus/tenancy';
import { KorapayRail } from '@clairtus/payments';
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

const SECRET = 'sk_test_m7secret';
// Real Korapay adapter with a fake fetch for the pay-in HTTP call (webhook verify/parse are pure).
const korapay = new KorapayRail({
  baseUrl: 'https://api.korapay.test',
  secretKey: SECRET,
  fetchImpl: (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { status: 'processing', bank_account: { account_number: '1234567890' } } }),
  })) as unknown as typeof fetch,
});

/** Sign a webhook body the way Korapay does: HMAC-SHA256(JSON.stringify(data)) with the secret. */
const sign = (data: unknown) => createHmac('sha256', SECRET).update(JSON.stringify(data)).digest('hex');

let app: INestApplication;
let sql: SqlExecutor;
let auth: string;
let tenantId: string;

beforeAll(async () => {
  const db = new PGlite();
  sql = executor(db);
  await applyAllSchema(sql);
  const tenancy = new Tenancy(sql);
  const t = await tenancy.createTenant({ name: 'Acme', country: 'ZA' });
  tenantId = t.id;
  auth = `Bearer ${(await tenancy.issueApiKey({ tenantId, mode: 'live', scopes: DEFAULT_WRITE_SCOPES })).plaintext}`;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL).useValue(sql)
    .overrideProvider(RAIL).useValue(korapay)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
});

afterAll(async () => { await app.close(); });

const http = () => request(app.getHttpServer());
// Sum across all accounts of a type — every escrow gets its own escrow_held account.
const balanceOf = async (type: string): Promise<number> => {
  const b = (await http().get('/v1/balances').set('Authorization', auth)).body as { data: { type: string; balance: number }[] };
  return b.data.filter((a) => a.type === type).reduce((s, a) => s + a.balance, 0);
};
const heldBalance = async (): Promise<number> => balanceOf('escrow_held');

async function awaitingEscrow(): Promise<string> {
  const seller = (await http().post('/v1/parties').set('Authorization', auth).send({ role: 'seller' })).body.id;
  const id = (await http().post('/v1/escrows').set('Authorization', auth)
    .send({ baseAmount: 100000, currency: 'ZAR', feeBps: 150, feeResponsibility: 'SELLER', sellerPartyId: seller })).body.id;
  await http().post(`/v1/escrows/${id}/fund`).set('Authorization', auth).set('Idempotency-Key', randomUUID());
  return id;
}

describe('inbound rail webhook (M7)', () => {
  it('charge.success funds the escrow exactly once (idempotent), driving AWAITING_FUNDING → FUNDED', async () => {
    const id = await awaitingEscrow();
    expect((await http().get(`/v1/escrows/${id}`).set('Authorization', auth)).body.status).toBe('AWAITING_FUNDING');
    const heldBefore = await heldBalance();

    const data = { reference: `payin:${id}`, amount: '1000.00', currency: 'ZAR', status: 'success' };
    const body = { event: 'charge.success', data };

    const res = await http().post('/v1/webhooks/korapay').set('x-korapay-signature', sign(data)).send(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, handled: true });

    expect((await http().get(`/v1/escrows/${id}`).set('Authorization', auth)).body.status).toBe('FUNDED');
    const heldAfter = await heldBalance();
    expect(heldAfter).toBe(heldBefore + 100000);
    const payin = await sql.query<{ status: string }>(`select status from payins where escrow_id = $1`, [id]);
    expect(payin.rows[0]!.status).toBe('succeeded');

    // Re-delivery is a no-op — no double funding.
    const replay = await http().post('/v1/webhooks/korapay').set('x-korapay-signature', sign(data)).send(body);
    expect(replay.status).toBe(200);
    expect(await heldBalance()).toBe(heldAfter); // unchanged
  });

  it('posts the actual settled net + PSP fee on charge.success, not the expected deposit (A3)', async () => {
    const id = await awaitingEscrow(); // expected deposit = 100000
    const heldBefore = await heldBalance();

    // Korapay settles NET of its fee: buyer paid 1000.00, Korapay deducted 15.00 → 985.00 actually lands.
    const data = { reference: `payin:${id}`, amount: '1000.00', fee: '15.00', currency: 'ZAR', status: 'success' };
    const res = await http().post('/v1/webhooks/korapay').set('x-korapay-signature', sign(data)).send({ event: 'charge.success', data });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, handled: true });

    // Held reflects the ACTUAL settled net (98500), not the expected deposit (100000) — custody is no
    // longer overstated, and the PSP fee is modeled in its own account so the ledger ⇄ PSP reconciles.
    expect(await heldBalance()).toBe(heldBefore + 98500);
    expect(await balanceOf('psp_fees')).toBe(1500);

    expect((await http().get(`/v1/escrows/${id}`).set('Authorization', auth)).body.status).toBe('FUNDED');
  });

  it('rejects a forged signature with 401', async () => {
    const data = { reference: `payin:${randomUUID()}`, amount: '1000.00', status: 'success' };
    const res = await http().post('/v1/webhooks/korapay').set('x-korapay-signature', 'forged').send({ event: 'charge.success', data });
    expect(res.status).toBe(401);
  });

  it('acknowledges an unrecognized event without acting (no retry storm)', async () => {
    const data = { reference: 'payin:whatever', status: 'pending' };
    const res = await http().post('/v1/webhooks/korapay').set('x-korapay-signature', sign(data)).send({ event: 'charge.pending', data });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, ignored: true });
  });

  it('transfer.success reconciles a pending payout to succeeded', async () => {
    // Seed a pending payout directly (the payout creation path is covered elsewhere).
    const payoutId = randomUUID();
    await sql.query(
      `insert into payouts (id, tenant_id, escrow_id, recipient_party_id, amount, currency, rail, rail_ref, status)
       values ($1,$2,$3,$4,$5,'ZAR','korapay',$6,'pending')`,
      [payoutId, tenantId, randomUUID(), randomUUID(), 5000, payoutId],
    );
    const data = { reference: payoutId, status: 'success' };
    const res = await http().post('/v1/webhooks/korapay').set('x-korapay-signature', sign(data)).send({ event: 'transfer.success', data });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, handled: true });
    const row = await sql.query<{ status: string }>(`select status from payouts where id = $1`, [payoutId]);
    expect(row.rows[0]!.status).toBe('succeeded');
  });
});
