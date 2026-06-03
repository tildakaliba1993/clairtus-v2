import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PGlite } from '@electric-sql/pglite';
import { Tenancy, type SqlExecutor } from '@clairtus/tenancy';
import { ClairtusClient, ClairtusApiError } from '@clairtus/sdk';
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

/** Drives the published @clairtus/sdk over real HTTP against the running app (the quickstart, tested). */
let app: INestApplication;
let sdk: ClairtusClient;

beforeAll(async () => {
  const db = new PGlite();
  const sql = executor(db);
  await applyAllSchema(sql);
  const tenancy = new Tenancy(sql);
  const t = await tenancy.createTenant({ name: 'Acme', country: 'ZA' });
  const apiKey = (await tenancy.issueApiKey({ tenantId: t.id, mode: 'test', scopes: [] })).plaintext;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL).useValue(sql)
    .overrideProvider(FETCH).useValue((async () => ({ ok: true, status: 200 }) as Response) as unknown as typeof fetch)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  sdk = new ClairtusClient({ baseUrl: `${url}/v1`, apiKey });
});

afterAll(async () => { await app.close(); });

describe('@clairtus/sdk against the live API', () => {
  it('runs the full escrow lifecycle end-to-end', async () => {
    const seller = (await sdk.parties.create({ role: 'seller', name: 'Sue' })) as any;
    const escrow = (await sdk.escrows.create({
      baseAmount: 100000, currency: 'ZAR', feeBps: 150, feeResponsibility: 'SELLER', sellerPartyId: seller.id,
    })) as any;
    expect(escrow.status).toBe('DRAFT');

    const funded = (await sdk.escrows.fund(escrow.id, { idempotencyKey: `fund-${escrow.id}` })) as any;
    expect(funded.status).toBe('FUNDED');
    expect(funded.depositAmount).toBe(100000);

    const released = (await sdk.escrows.release(escrow.id)) as any;
    expect(released.status).toBe('RELEASED');

    const payout = (await sdk.payouts.create({ escrowId: escrow.id, recipientPartyId: seller.id, amount: 98500 })) as any;
    expect(payout).toMatchObject({ status: 'succeeded', rail: 'simulated' }); // test key → sandbox rail

    const balances = (await sdk.balances()) as { data: { type: string; ownerRef: string | null; balance: number }[] };
    const recip = balances.data.find((a) => a.type === 'recipient_payable' && a.ownerRef === seller.id);
    expect(recip?.balance).toBe(0);
  });

  it('surfaces API errors as ClairtusApiError (release before fund → 409)', async () => {
    const seller = (await sdk.parties.create({ role: 'seller' })) as any;
    const escrow = (await sdk.escrows.create({
      baseAmount: 1000, currency: 'ZAR', feeBps: 0, feeResponsibility: 'SELLER', sellerPartyId: seller.id,
    })) as any;
    await expect(sdk.escrows.release(escrow.id)).rejects.toBeInstanceOf(ClairtusApiError);
    await expect(sdk.escrows.release(escrow.id)).rejects.toMatchObject({ status: 409, code: 'conflict' });
  });
});
