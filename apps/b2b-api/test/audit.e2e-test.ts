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
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
});

afterAll(async () => { await app.close(); });

const http = () => request(app.getHttpServer());
const idem = () => ({ 'Idempotency-Key': randomUUID() });

describe('immutable audit log (PR-5.2)', () => {
  it('records an audit row for every money operation in the lifecycle', async () => {
    const seller = (await http().post('/v1/parties').set('Authorization', auth).send({ role: 'seller', accountRef: '0000000000', bankCode: '033' })).body.id;
    const escrowId = (await http().post('/v1/escrows').set('Authorization', auth)
      .send({ baseAmount: 100000, currency: 'ZAR', feeBps: 150, feeResponsibility: 'SELLER', sellerPartyId: seller })).body.id;
    await http().post(`/v1/escrows/${escrowId}/fund`).set('Authorization', auth).set(idem());
    await http().post(`/v1/escrows/${escrowId}/release`).set('Authorization', auth).set(idem());
    await http().post('/v1/payouts').set('Authorization', auth).set(idem()).send({ escrowId, recipientPartyId: seller, amount: 98500 });

    const rows = await sql.query<{ action: string; escrow_id: string | null; resource_type: string }>(
      `select action, escrow_id, resource_type from audit_log where tenant_id = $1 order by created_at`,
      [tenantId],
    );
    const actions = rows.rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining([
      'party.created',
      'escrow.created',
      'escrow.funded',
      'escrow.released',
      'payout.created',
    ]));
    // The escrow's own actions are all tagged with its id (queryable by escrow).
    const escrowActions = rows.rows.filter((r) => r.escrow_id === escrowId).map((r) => r.action);
    expect(escrowActions).toEqual(expect.arrayContaining(['escrow.created', 'escrow.funded', 'escrow.released', 'payout.created']));
  });

  it('is append-only — actions accumulate, never overwrite', async () => {
    const before = (await sql.query<{ n: number }>(`select count(*)::int as n from audit_log where tenant_id = $1`, [tenantId])).rows[0]!.n;
    const seller = (await http().post('/v1/parties').set('Authorization', auth).send({ role: 'seller' })).body.id;
    await http().post('/v1/escrows').set('Authorization', auth)
      .send({ baseAmount: 5000, currency: 'ZAR', feeBps: 0, feeResponsibility: 'SELLER', sellerPartyId: seller });
    const after = (await sql.query<{ n: number }>(`select count(*)::int as n from audit_log where tenant_id = $1`, [tenantId])).rows[0]!.n;
    expect(after).toBeGreaterThan(before); // +party.created +escrow.created
  });
});
