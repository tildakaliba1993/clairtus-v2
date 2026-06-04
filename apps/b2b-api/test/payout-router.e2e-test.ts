import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Tenancy, type SqlExecutor } from '@clairtus/tenancy';
import { RailRouter, SimulatedRail, type PaymentRail } from '@clairtus/payments';
import { JobQueue } from '@clairtus/queue';
import { AppModule } from '../src/app.module';
import { DEFAULT_WRITE_SCOPES } from '../src/common/scopes';
import { SQL, PAYOUT_ROUTERS } from '../src/db/sql';
import { applyAllSchema } from '../src/db/schema';
import { EscrowService } from '../src/escrow/escrow.service';
import { PAYOUT_DISPATCH_QUEUE, type PayoutDispatchJob } from '../src/escrow/payout-dispatch';

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

/** A controllable live rail whose payout either throws (down) or succeeds. */
function makeRail(id: string) {
  const state = { down: false };
  const rail: PaymentRail = {
    id,
    capabilities: { payIn: true, payOut: true, hold: true, countries: ['ZA'], currencies: ['ZAR'], methods: ['bank_transfer'] },
    async initiatePayIn(req) { return { railRef: req.reference, status: 'pending' }; },
    async initiatePayout(req) {
      if (state.down) throw new Error(`${id} unavailable`);
      return { railRef: `${id}:${req.reference}`, status: 'succeeded' };
    },
    async getStatus(railRef) { return { railRef, status: 'succeeded' }; },
    parseWebhook() { return null; },
    verifyWebhook() { return true; },
  };
  return { rail, state };
}

const a = makeRail('rail-a');
const b = makeRail('rail-b');
const liveRouter = new RailRouter().register(a.rail, { priority: 0 }).register(b.rail, { priority: 1 });
const sandboxRouter = new RailRouter().register(new SimulatedRail());

let app: INestApplication;
let sql: SqlExecutor;
let svc: EscrowService;
let testAuth: string;
let liveAuth: string;
let tenantId: string;

beforeAll(async () => {
  const db = new PGlite();
  sql = executor(db);
  await applyAllSchema(sql);
  const tenancy = new Tenancy(sql);
  const t = await tenancy.createTenant({ name: 'Acme', country: 'ZA' });
  tenantId = t.id;
  testAuth = `Bearer ${(await tenancy.issueApiKey({ tenantId, mode: 'test', scopes: DEFAULT_WRITE_SCOPES })).plaintext}`;
  liveAuth = `Bearer ${(await tenancy.issueApiKey({ tenantId, mode: 'live', scopes: DEFAULT_WRITE_SCOPES })).plaintext}`;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL).useValue(sql)
    .overrideProvider(PAYOUT_ROUTERS).useValue({ live: liveRouter, sandbox: sandboxRouter })
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
  svc = app.get(EscrowService);
});

afterAll(async () => { await app.close(); });

const http = () => request(app.getHttpServer());
const idem = () => ({ 'Idempotency-Key': randomUUID() });
const owedBalance = async (sellerId: string): Promise<number> => {
  const b = (await http().get('/v1/balances').set('Authorization', testAuth)).body as { data: { type: string; ownerRef: string | null; balance: number }[] };
  return b.data.find((x) => x.type === 'recipient_payable' && x.ownerRef === sellerId)?.balance ?? 0;
};

/** A funded + released escrow (sandbox/test mode) so the recipient is owed 98500. */
async function owedEscrow(): Promise<{ escrowId: string; sellerId: string }> {
  const sellerId = (await http().post('/v1/parties').set('Authorization', testAuth).send({ role: 'seller', accountRef: '0000000000', bankCode: '033' })).body.id;
  const escrowId = (await http().post('/v1/escrows').set('Authorization', testAuth)
    .send({ baseAmount: 100000, currency: 'ZAR', feeBps: 150, feeResponsibility: 'SELLER', sellerPartyId: sellerId })).body.id;
  await http().post(`/v1/escrows/${escrowId}/fund`).set('Authorization', testAuth).set(idem());
  await http().post(`/v1/escrows/${escrowId}/release`).set('Authorization', testAuth).set(idem());
  return { escrowId, sellerId };
}

describe('payouts via RailRouter (PR-8.1)', () => {
  it('fails over to the next rail when the first is down', async () => {
    a.state.down = true;
    b.state.down = false;
    const { escrowId, sellerId } = await owedEscrow();
    const res = await http().post('/v1/payouts').set('Authorization', liveAuth).set(idem())
      .send({ escrowId, recipientPartyId: sellerId, amount: 98500 });
    expect(res.status).toBe(201);
    expect(res.body.rail).toBe('rail-b'); // failed over from rail-a
    expect(res.body.status).toBe('succeeded');
    expect(await owedBalance(sellerId)).toBe(0); // funds left the recipient balance
  });

  it('enqueues a durable retry when all rails are unavailable, then the worker dispatches it', async () => {
    a.state.down = true;
    b.state.down = true;
    const { escrowId, sellerId } = await owedEscrow();
    const res = await http().post('/v1/payouts').set('Authorization', liveAuth).set(idem())
      .send({ escrowId, recipientPartyId: sellerId, amount: 98500 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.rail).toBeNull();
    expect(await owedBalance(sellerId)).toBe(98500); // NOT debited yet — disbursement only queued

    const jobs = await sql.query<{ n: number }>(`select count(*)::int as n from jobs where queue = $1 and status = 'pending'`, [PAYOUT_DISPATCH_QUEUE]);
    expect(jobs.rows[0]!.n).toBeGreaterThan(0);

    // A rail recovers; the worker drains the queue and the payout completes.
    b.state.down = false;
    const queue = new JobQueue(sql);
    const outcome = await queue.process<PayoutDispatchJob>(PAYOUT_DISPATCH_QUEUE, (job) => svc.dispatchQueuedPayout(job));
    expect(outcome).toBe('done');
    expect(res.body.id).toBeTruthy();
    expect(await owedBalance(sellerId)).toBe(0); // now debited via the worker
  });

  it('dead-letters a dispatch job once it exhausts its attempts', async () => {
    a.state.down = true;
    b.state.down = true;
    const payoutId = randomUUID();
    await sql.query(
      `insert into payouts (id, tenant_id, escrow_id, recipient_party_id, amount, currency, status)
       values ($1,$2,$3,$4,5000,'ZAR','pending')`,
      [payoutId, tenantId, randomUUID(), randomUUID()],
    );
    const queue = new JobQueue(sql);
    const job: PayoutDispatchJob = { payoutId, tenantId, escrowId: randomUUID(), recipientPartyId: randomUUID(), amount: 5000, currency: 'ZAR', country: 'ZA' };
    await queue.enqueue(PAYOUT_DISPATCH_QUEUE, job, { maxAttempts: 1 });
    const outcome = await queue.process<PayoutDispatchJob>(PAYOUT_DISPATCH_QUEUE, (j) => svc.dispatchQueuedPayout(j));
    expect(outcome).toBe('dead'); // all rails down + attempts exhausted → DLQ
  });
});
