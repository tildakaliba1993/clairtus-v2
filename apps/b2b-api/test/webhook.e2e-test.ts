import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Tenancy, type SqlExecutor } from '@clairtus/tenancy';
import { AppModule } from '../src/app.module';
import { DEFAULT_WRITE_SCOPES } from '../src/common/scopes';
import { SQL, FETCH } from '../src/db/sql';
import { applyAllSchema } from '../src/db/schema';
import { WebhookService } from '../src/webhooks/webhook.service';
import { verifyWebhookSignature } from '../src/webhooks/signing';

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

// Controllable fake fetch: records calls; `mode` flips success/failure per test.
const fetchCalls: { url: string; headers: Record<string, string>; body: string }[] = [];
let fetchMode: 'ok' | 'fail' = 'ok';
const fakeFetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
  fetchCalls.push({ url: String(url), headers: init.headers, body: init.body });
  return { ok: fetchMode === 'ok', status: fetchMode === 'ok' ? 200 : 500 } as Response;
}) as unknown as typeof fetch;

let app: INestApplication;
let auth: string;
let tenantId: string;
let signingSecret: string;

beforeAll(async () => {
  const db = new PGlite();
  const sql = executor(db);
  await applyAllSchema(sql);
  const tenancy = new Tenancy(sql);
  tenantId = (await tenancy.createTenant({ name: 'A', country: 'ZA' })).id;
  auth = `Bearer ${(await tenancy.issueApiKey({ tenantId, mode: 'live', scopes: DEFAULT_WRITE_SCOPES })).plaintext}`;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL).useValue(sql)
    .overrideProvider(FETCH).useValue(fakeFetch)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
});

afterAll(async () => { await app.close(); });

const http = () => request(app.getHttpServer());

async function makeFundedEscrow(): Promise<string> {
  const seller = (await http().post('/v1/parties').set('Authorization', auth).send({ role: 'seller' })).body;
  const escrowId = (await http().post('/v1/escrows').set('Authorization', auth).send({
    baseAmount: 100000, currency: 'ZAR', feeBps: 150, feeResponsibility: 'SELLER', sellerPartyId: seller.id,
  })).body.id;
  await http().post(`/v1/escrows/${escrowId}/fund`).set('Authorization', auth).set('Idempotency-Key', randomUUID());
  return escrowId;
}

describe('outbound webhooks (T3.4)', () => {
  it('registers an endpoint and returns the signing secret once', async () => {
    const res = await http().post('/v1/webhook-endpoints').set('Authorization', auth).send({ url: 'https://hook.example/cb' });
    expect(res.status).toBe(201);
    expect(res.body.signingSecret).toMatch(/^whsec_/);
    signingSecret = res.body.signingSecret;
  });

  it('rejects a non-https endpoint url (B10 — no plaintext webhook delivery)', async () => {
    const res = await http().post('/v1/webhook-endpoints').set('Authorization', auth).send({ url: 'http://hook.example/cb' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/https/);
  });

  it('rejects a malformed endpoint url', async () => {
    const res = await http().post('/v1/webhook-endpoints').set('Authorization', auth).send({ url: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('delivers a signed escrow.funded event whose signature verifies', async () => {
    fetchMode = 'ok';
    fetchCalls.length = 0;
    await makeFundedEscrow();

    const call = fetchCalls.find((c) => c.url === 'https://hook.example/cb');
    expect(call).toBeDefined();
    const sig = call!.headers['X-Clairtus-Signature']!;
    expect(verifyWebhookSignature(signingSecret, call!.body, sig)).toBe(true);
    const payload = JSON.parse(call!.body);
    expect(payload.type).toBe('escrow.funded');

    const deliveries = (await http().get('/v1/webhook-deliveries').set('Authorization', auth)).body;
    expect(deliveries.data.some((d: { event_type: string; status: string }) => d.event_type === 'escrow.funded' && d.status === 'delivered')).toBe(true);
  });

  it('a failing endpoint does not break the API call; delivery is pending + retried by processDue', async () => {
    fetchMode = 'fail';
    const escrowId = await makeFundedEscrow(); // fund still succeeds despite webhook failure
    expect((await http().get(`/v1/escrows/${escrowId}`).set('Authorization', auth)).body.status).toBe('FUNDED');

    let deliveries = (await http().get('/v1/webhook-deliveries').set('Authorization', auth)).body;
    const pending = deliveries.data.find((d: { status: string; attempts: number; last_error: string }) => d.status === 'pending');
    expect(pending).toBeDefined();
    expect(pending.attempts).toBe(1);
    expect(pending.last_error).toBe('HTTP 500');

    // Recover: endpoint comes back, the retry worker drains due deliveries.
    fetchMode = 'ok';
    const svc = app.get(WebhookService);
    const retried = await svc.processDue(tenantId, Date.now() + 3_600_000);
    expect(retried).toBeGreaterThanOrEqual(1);

    deliveries = (await http().get('/v1/webhook-deliveries').set('Authorization', auth)).body;
    expect(deliveries.data.every((d: { status: string }) => d.status !== 'pending')).toBe(true);
  });

  it('replays a delivery on demand', async () => {
    fetchMode = 'ok';
    const deliveries = (await http().get('/v1/webhook-deliveries').set('Authorization', auth)).body;
    const id = deliveries.data[0].id;
    fetchCalls.length = 0;
    const res = await http().post(`/v1/webhook-deliveries/${id}/replay`).set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(fetchCalls.length).toBe(1);
  });
});
