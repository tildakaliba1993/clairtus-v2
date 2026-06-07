import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Tenancy, type SqlExecutor } from '@clairtus/tenancy';
import { AppModule } from '../src/app.module';
import { DEFAULT_WRITE_SCOPES, SCOPES } from '../src/common/scopes';
import { SQL } from '../src/db/sql';
import { applyAllSchema } from '../src/db/schema';
import { ReconciliationService } from '../src/recon/reconciliation.service';

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
let auth: string;
let opsAuth: string; // key with the operator-only ops:read scope
let recon: ReconciliationService;

beforeAll(async () => {
  const db = new PGlite();
  const sql = executor(db);
  await applyAllSchema(sql);
  const tenancy = new Tenancy(sql);
  const t = await tenancy.createTenant({ name: 'Acme', country: 'ZA' });
  auth = `Bearer ${(await tenancy.issueApiKey({ tenantId: t.id, mode: 'test', scopes: DEFAULT_WRITE_SCOPES })).plaintext}`;
  opsAuth = `Bearer ${(await tenancy.issueApiKey({ tenantId: t.id, mode: 'test', scopes: [SCOPES.opsRead] })).plaintext}`;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL).useValue(sql)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
  recon = app.get(ReconciliationService);
});

afterAll(async () => { await app.close(); });

const http = () => request(app.getHttpServer());
const idem = () => ({ 'Idempotency-Key': randomUUID() });

describe('reconciliation: ledger ↔ PSP balance (PR-11.1)', () => {
  it('reports zero drift when the PSP balance matches the ledger custody', async () => {
    // Fund R1000 → escrow_held is credited 100000 (our custody obligation in ZAR).
    const seller = (await http().post('/v1/parties').set('Authorization', auth).send({ role: 'seller' })).body.id;
    const id = (await http().post('/v1/escrows').set('Authorization', auth)
      .send({ baseAmount: 100000, currency: 'ZAR', feeBps: 0, feeResponsibility: 'SELLER', sellerPartyId: seller })).body.id;
    await http().post(`/v1/escrows/${id}/fund`).set('Authorization', auth).set(idem());

    const matched = await recon.reconcile({ ZAR: 100000 });
    const zar = matched.find((r) => r.currency === 'ZAR')!;
    expect(zar).toMatchObject({ ledgerMinor: 100000, railMinor: 100000, driftMinor: 0, ok: true });
  });

  it('flags drift when the PSP balance disagrees with the ledger', async () => {
    const short = await recon.reconcile({ ZAR: 90000 });
    const zar = short.find((r) => r.currency === 'ZAR')!;
    expect(zar.driftMinor).toBe(10000);
    expect(zar.ok).toBe(false);

    // A currency present only in the ledger (PSP reports nothing) is full drift.
    const none = await recon.reconcile({});
    expect(none.find((r) => r.currency === 'ZAR')!.ok).toBe(false);

    // Within tolerance → ok.
    const tol = await recon.reconcile({ ZAR: 90000 }, 10000);
    expect(tol.find((r) => r.currency === 'ZAR')!.ok).toBe(true);
  });
});

describe('operational metrics (PR-11.3)', () => {
  it('GET /v1/system/metrics returns queue + webhook counters for an ops:read key', async () => {
    const res = await http().get('/v1/system/metrics').set('Authorization', opsAuth);
    expect(res.status).toBe(200);
    expect(res.body.queue.payoutDispatch).toMatchObject({ pending: 0, processing: 0, done: 0, dead: 0 });
    expect(res.body.webhooks).toHaveProperty('due');
    expect(res.body.webhooks).toHaveProperty('stuck');
  });

  it('requires authentication', async () => {
    expect((await http().get('/v1/system/metrics')).status).toBe(401);
  });

  it('forbids a standard tenant key without ops:read (B11 — no system-wide info leak)', async () => {
    const res = await http().get('/v1/system/metrics').set('Authorization', auth);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/ops:read/);
  });
});
