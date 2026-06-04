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

// Per-market KYC tier: ZA requires a VERIFIED seller to release above $100. FX 1:1 so minor/100 = USD.
const config: ComplianceConfig = {
  rulesByCountry: { ZA: { minUsd: 0, dailyMaxUsd: 100000, monthlyMaxUsd: 100000 } },
  defaultRules: { minUsd: 0, dailyMaxUsd: 100000, monthlyMaxUsd: 100000 },
  fxRatesPerUsd: { USD: 1, ZAR: 1 },
  kycTierUsdByCountry: { ZA: 100 }, // → R100.00 (10000 minor) release tier
  structuringThreshold: 99,
  minorUnitExponent: 2,
};

let app: INestApplication;
let auth: string;

beforeAll(async () => {
  const db = new PGlite();
  const sql = executor(db);
  await applyAllSchema(sql);
  const tenancy = new Tenancy(sql);
  const t = await tenancy.createTenant({ name: 'Acme', country: 'ZA' });
  auth = `Bearer ${(await tenancy.issueApiKey({ tenantId: t.id, mode: 'test', scopes: DEFAULT_WRITE_SCOPES })).plaintext}`;

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
const idem = () => ({ 'Idempotency-Key': randomUUID() });

async function fundedEscrow(baseAmount: number): Promise<string> {
  const seller = (await http().post('/v1/parties').set('Authorization', auth).send({ role: 'seller' })).body.id; // unverified
  const id = (await http().post('/v1/escrows').set('Authorization', auth)
    .send({ baseAmount, currency: 'ZAR', feeBps: 0, feeResponsibility: 'SELLER', sellerPartyId: seller })).body.id;
  await http().post(`/v1/escrows/${id}/fund`).set('Authorization', auth).set(idem());
  return id;
}

describe('per-market KYC release tiers (M9 / PR-9.2)', () => {
  it('blocks a release ABOVE the ZA tier when the seller is unverified (403)', async () => {
    const id = await fundedEscrow(20000); // $200 > $100 tier
    const res = await http().post(`/v1/escrows/${id}/release`).set('Authorization', auth).set(idem());
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/ZA/); // mentions the market
  });

  it('allows a release AT/BELOW the tier without verification', async () => {
    const id = await fundedEscrow(5000); // $50 < $100 tier
    const res = await http().post(`/v1/escrows/${id}/release`).set('Authorization', auth).set(idem());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('RELEASED');
  });
});
