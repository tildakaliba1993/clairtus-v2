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
import { COMPLIANCE_CONFIG, type ComplianceConfig } from '../src/escrow/compliance';
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

// Tiny limits + 1:1 ZAR→USD so amounts are easy to reason about: minor/100 = USD.
const config: ComplianceConfig = {
  rulesByCountry: { ZA: { minUsd: 1, dailyMaxUsd: 100, monthlyMaxUsd: 200 } },
  defaultRules: { minUsd: 1, dailyMaxUsd: 100, monthlyMaxUsd: 200 },
  fxRatesPerUsd: { USD: 1, ZAR: 1 },
  kycTierUsdByCountry: {},
  structuringThreshold: 2,
  minorUnitExponent: 2,
};

let app: INestApplication;
let sql: SqlExecutor;
let tenancy: Tenancy;

beforeAll(async () => {
  const db = new PGlite();
  sql = executor(db);
  await applyAllSchema(sql);
  tenancy = new Tenancy(sql);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL).useValue(sql)
    .overrideProvider(COMPLIANCE_CONFIG).useValue(config)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
});

afterAll(async () => { await app.close(); });

const http = () => request(app.getHttpServer());

/** Fresh tenant per test so daily/monthly volume windows don't bleed across tests. */
async function freshTenant(): Promise<{ auth: string; tenantId: string }> {
  const t = await tenancy.createTenant({ name: 'Acme', country: 'ZA' });
  const key = (await tenancy.issueApiKey({ tenantId: t.id, mode: 'live', scopes: DEFAULT_WRITE_SCOPES })).plaintext;
  return { auth: `Bearer ${key}`, tenantId: t.id };
}

async function makeSeller(auth: string): Promise<string> {
  return (await http().post('/v1/parties').set('Authorization', auth).send({ role: 'seller' })).body.id;
}

function escrow(sellerId: string, baseAmount: number, buyerPartyId?: string) {
  return { baseAmount, currency: 'ZAR', feeBps: 0, feeResponsibility: 'SELLER', sellerPartyId: sellerId, ...(buyerPartyId ? { buyerPartyId } : {}) };
}

describe('compliance: amount bounds (PR-3.1)', () => {
  it('422 above the per-transaction maximum', async () => {
    const { auth } = await freshTenant();
    const seller = await makeSeller(auth);
    const res = await http().post('/v1/escrows').set('Authorization', auth).send(escrow(seller, 100000)); // $1000 > $100
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/maximum/i);
  });

  it('422 below the per-transaction minimum', async () => {
    const { auth } = await freshTenant();
    const seller = await makeSeller(auth);
    const res = await http().post('/v1/escrows').set('Authorization', auth).send(escrow(seller, 50)); // $0.50 < $1
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/minimum/i);
  });

  it('201 within bounds', async () => {
    const { auth } = await freshTenant();
    const seller = await makeSeller(auth);
    const res = await http().post('/v1/escrows').set('Authorization', auth).send(escrow(seller, 5000)); // $50
    expect(res.status).toBe(201);
  });
});

describe('compliance: cumulative volume (PR-3.2)', () => {
  it('rejects the create that would exceed the daily volume limit', async () => {
    const { auth } = await freshTenant();
    const seller = await makeSeller(auth);
    const first = await http().post('/v1/escrows').set('Authorization', auth).send(escrow(seller, 6000)); // $60, daily=60
    expect(first.status).toBe(201);
    const second = await http().post('/v1/escrows').set('Authorization', auth).send(escrow(seller, 6000)); // +$60 → $120 > $100
    expect(second.status).toBe(422);
    expect(second.body.error.message).toMatch(/daily/i);
  });
});

describe('compliance: structuring signal (PR-3.3)', () => {
  it('flags repeated escrows with the same counterparty in the decision record', async () => {
    const { auth, tenantId } = await freshTenant();
    const seller = await makeSeller(auth);
    const buyer = (await http().post('/v1/parties').set('Authorization', auth).send({ role: 'buyer' })).body.id;
    // 3 small escrows ($10 each, within limits) between the same buyer→seller.
    for (let i = 0; i < 3; i++) {
      const r = await http().post('/v1/escrows').set('Authorization', auth).send(escrow(seller, 1000, buyer));
      expect(r.status).toBe(201);
    }
    const decisions = await sql.query<{ structuring: boolean }>(
      `select structuring from compliance_decisions where tenant_id = $1 and outcome = 'allow' order by created_at`,
      [tenantId],
    );
    // threshold 2: the 3rd create (2 priors) is flagged.
    expect(decisions.rows.some((d) => d.structuring === true)).toBe(true);
  });
});
