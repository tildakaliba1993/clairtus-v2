import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Tenancy, type SqlExecutor } from '@clairtus/tenancy';
import { SmileIdProvider } from '@clairtus/kyc';
import { AppModule } from '../src/app.module';
import { DEFAULT_WRITE_SCOPES } from '../src/common/scopes';
import { SQL, FETCH, KYC_PROVIDER, KYC_RELEASE_THRESHOLD } from '../src/db/sql';
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

const PARTNER = 'partner-x';
const API_KEY = 'sid_key';
const THRESHOLD = 50000; // releases above R500 require a verified seller

// Build the Smile ID signature the provider would accept on a callback.
const smileSig = (ts: string) => createHmac('sha256', API_KEY).update(`${ts}${PARTNER}sid_request`).digest('base64');

let app: INestApplication;
let auth: string;

beforeAll(async () => {
  const db = new PGlite();
  const sql = executor(db);
  await applyAllSchema(sql);
  const tenancy = new Tenancy(sql);
  const t = await tenancy.createTenant({ name: 'A', country: 'ZA' });
  auth = `Bearer ${(await tenancy.issueApiKey({ tenantId: t.id, mode: 'live', scopes: DEFAULT_WRITE_SCOPES })).plaintext}`;

  // Real Smile ID provider with a fake fetch for the /v1/token call.
  const provider = new SmileIdProvider({
    baseUrl: 'https://testapi.smileidentity.com', partnerId: PARTNER, apiKey: API_KEY,
    fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ token: 'tok_session' }) }) as Response) as unknown as typeof fetch,
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL).useValue(sql)
    .overrideProvider(KYC_PROVIDER).useValue(provider)
    .overrideProvider(KYC_RELEASE_THRESHOLD).useValue(THRESHOLD)
    .overrideProvider(FETCH).useValue((async () => ({ ok: true, status: 200 }) as Response) as unknown as typeof fetch)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
});

afterAll(async () => { await app.close(); });

const http = () => request(app.getHttpServer());

async function makeFundedEscrow(sellerId: string, baseAmount: number): Promise<string> {
  const id = (await http().post('/v1/escrows').set('Authorization', auth).send({
    baseAmount, currency: 'ZAR', feeBps: 0, feeResponsibility: 'SELLER', sellerPartyId: sellerId,
  })).body.id;
  await http().post(`/v1/escrows/${id}/fund`).set('Authorization', auth).set('Idempotency-Key', randomUUID());
  return id;
}

describe('KYC checks + Smile ID + gated release (T4.1)', () => {
  let sellerId: string;
  let checkId: string;

  it('starts a verification and returns a session token', async () => {
    sellerId = (await http().post('/v1/parties').set('Authorization', auth).send({ role: 'seller', phone: '+27123' })).body.id;
    const res = await http().post('/v1/kyc/checks').set('Authorization', auth).send({ partyId: sellerId, level: 'biometric' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'PENDING', provider: 'smile-id', token: 'tok_session' });
    checkId = res.body.id;
    expect((await http().get(`/v1/kyc/checks/${checkId}`).set('Authorization', auth)).body.status).toBe('PENDING');
  });

  it('blocks a high-value release while the seller is unverified (403)', async () => {
    const escrowId = await makeFundedEscrow(sellerId, 100000); // > THRESHOLD
    const res = await http().post(`/v1/escrows/${escrowId}/release`).set('Authorization', auth).set('Idempotency-Key', randomUUID());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('rejects a callback with a bad signature (401)', async () => {
    const res = await http().post('/v1/kyc/callback').send({
      PartnerParams: { user_id: sellerId }, ResultCode: '0810', IsFinalResult: 'true',
      timestamp: new Date().toISOString(), signature: 'forged',
    });
    expect(res.status).toBe(401);
  });

  it('a valid signed final callback verifies the party', async () => {
    const ts = new Date().toISOString();
    const res = await http().post('/v1/kyc/callback').send({
      PartnerParams: { user_id: sellerId }, ResultCode: '0810', SmileJobID: 'job-1', IsFinalResult: 'true',
      timestamp: ts, signature: smileSig(ts),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 'VERIFIED' });

    expect((await http().get(`/v1/parties/${sellerId}`).set('Authorization', auth)).body.kycStatus).toBe('VERIFIED');
    expect((await http().get(`/v1/kyc/checks/${checkId}`).set('Authorization', auth)).body.status).toBe('VERIFIED');
  });

  it('allows the high-value release once the seller is verified', async () => {
    const escrowId = await makeFundedEscrow(sellerId, 100000);
    const res = await http().post(`/v1/escrows/${escrowId}/release`).set('Authorization', auth).set('Idempotency-Key', randomUUID());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('RELEASED');
  });

  it('does not gate releases at or below the threshold', async () => {
    const freshSeller = (await http().post('/v1/parties').set('Authorization', auth).send({ role: 'seller' })).body.id; // unverified
    const escrowId = await makeFundedEscrow(freshSeller, THRESHOLD); // not above threshold
    const res = await http().post(`/v1/escrows/${escrowId}/release`).set('Authorization', auth).set('Idempotency-Key', randomUUID());
    expect(res.status).toBe(200);
  });
});
