import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
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

let app: INestApplication;
let auth: string;

beforeAll(async () => {
  const db = new PGlite();
  const sql = executor(db);
  await applyAllSchema(sql);
  const tenancy = new Tenancy(sql);
  const t = await tenancy.createTenant({ name: 'Acme', country: 'ZA' });
  auth = `Bearer ${(await tenancy.issueApiKey({ tenantId: t.id, mode: 'live', scopes: DEFAULT_WRITE_SCOPES })).plaintext}`;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL).useValue(sql)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
});

afterAll(async () => { await app.close(); });

const http = () => request(app.getHttpServer());

describe('cursor pagination on list endpoints (PR-4.4)', () => {
  it('pages through escrows with limit + nextCursor', async () => {
    const seller = (await http().post('/v1/parties').set('Authorization', auth).send({ role: 'seller' })).body.id;
    for (let i = 0; i < 3; i++) {
      const r = await http().post('/v1/escrows').set('Authorization', auth)
        .send({ baseAmount: 5000, currency: 'ZAR', feeBps: 0, feeResponsibility: 'SELLER', sellerPartyId: seller });
      expect(r.status).toBe(201);
    }

    const page1 = await http().get('/v1/escrows?limit=2').set('Authorization', auth);
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await http().get(`/v1/escrows?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`).set('Authorization', auth);
    expect(page2.status).toBe(200);
    expect(page2.body.data).toHaveLength(1); // 3 total → last page has the remainder
    expect(page2.body.nextCursor).toBeNull();

    // No overlap between pages (stable cursor).
    const ids1 = page1.body.data.map((e: { id: string }) => e.id);
    const ids2 = page2.body.data.map((e: { id: string }) => e.id);
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
  });
});
