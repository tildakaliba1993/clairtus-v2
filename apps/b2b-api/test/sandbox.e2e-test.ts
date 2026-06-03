import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { Tenancy, type SqlExecutor } from '@clairtus/tenancy';
import { AppModule } from '../src/app.module';
import { SQL, FETCH } from '../src/db/sql';
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
let testKey: string; // mode=test → sandbox / simulated rail
let liveKey: string; // mode=live → real rail (none configured here)

beforeAll(async () => {
  const db = new PGlite();
  const sql = executor(db);
  await applyAllSchema(sql);
  const tenancy = new Tenancy(sql);
  const t = await tenancy.createTenant({ name: 'A', country: 'ZA' });
  testKey = (await tenancy.issueApiKey({ tenantId: t.id, mode: 'test', scopes: [] })).plaintext;
  liveKey = (await tenancy.issueApiKey({ tenantId: t.id, mode: 'live', scopes: [] })).plaintext;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL).useValue(sql)
    // LIVE rail intentionally left as the null default; SIMULATED_RAIL is the module default.
    .overrideProvider(FETCH).useValue((async () => ({ ok: true, status: 200 }) as Response) as unknown as typeof fetch)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
});

afterAll(async () => { await app.close(); });

const http = () => request(app.getHttpServer());
const balOf = (body: { data: { type: string; ownerRef: string | null; balance: number }[] }, type: string, owner: string) =>
  body.data.find((a) => a.type === type && a.ownerRef === owner)?.balance ?? 0;

/** Create → fund → release a base=100000 SELLER-fee escrow; seller is then owed 98500. */
async function releasedEscrow(auth: string): Promise<{ escrowId: string; sellerId: string }> {
  const sellerId = (await http().post('/v1/parties').set('Authorization', auth).send({ role: 'seller' })).body.id;
  const escrowId = (await http().post('/v1/escrows').set('Authorization', auth).send({
    baseAmount: 100000, currency: 'ZAR', feeBps: 150, feeResponsibility: 'SELLER', sellerPartyId: sellerId,
  })).body.id;
  await http().post(`/v1/escrows/${escrowId}/fund`).set('Authorization', auth);
  await http().post(`/v1/escrows/${escrowId}/release`).set('Authorization', auth);
  return { escrowId, sellerId };
}

describe('sandbox: test-mode keys route to the simulated rail (T4.2)', () => {
  it('a test-key payout disburses through the simulated rail and debits the recipient', async () => {
    const auth = `Bearer ${testKey}`;
    const { escrowId, sellerId } = await releasedEscrow(auth);
    const payout = await http().post('/v1/payouts').set('Authorization', auth).send({ escrowId, recipientPartyId: sellerId, amount: 98500 });
    expect(payout.status).toBe(201);
    expect(payout.body.rail).toBe('simulated');
    expect(payout.body.railRef).toBe(`sim_po_${payout.body.id}`);
    expect(payout.body.status).toBe('succeeded');

    const balances = (await http().get('/v1/balances').set('Authorization', auth)).body;
    expect(balOf(balances, 'recipient_payable', sellerId)).toBe(0); // funds left the recipient balance
  });

  it('a deterministic failure trigger fails the payout WITHOUT moving funds', async () => {
    const auth = `Bearer ${testKey}`;
    const { escrowId, sellerId } = await releasedEscrow(auth);
    const payout = await http().post('/v1/payouts').set('Authorization', auth)
      .send({ escrowId, recipientPartyId: sellerId, amount: 98500, metadata: { simulate: 'failed' } });
    expect(payout.status).toBe(201);
    expect(payout.body).toMatchObject({ rail: 'simulated', status: 'failed' });

    // A failed disbursement must not debit the recipient — they are still owed the full amount.
    const balances = (await http().get('/v1/balances').set('Authorization', auth)).body;
    expect(balOf(balances, 'recipient_payable', sellerId)).toBe(98500);
  });

  it('parity: a live-key payout runs the identical flow (here no live rail → pending, but still posts)', async () => {
    const auth = `Bearer ${liveKey}`;
    const { escrowId, sellerId } = await releasedEscrow(auth);
    const payout = await http().post('/v1/payouts').set('Authorization', auth).send({ escrowId, recipientPartyId: sellerId, amount: 98500 });
    expect(payout.status).toBe(201);
    expect(payout.body.rail).toBeNull();
    expect(payout.body.status).toBe('pending');
    const balances = (await http().get('/v1/balances').set('Authorization', auth)).body;
    expect(balOf(balances, 'recipient_payable', sellerId)).toBe(0);
  });
});
