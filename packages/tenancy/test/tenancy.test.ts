import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Tenancy, type SqlExecutor } from '../src';

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
          transaction() {
            throw new Error('nested transaction not supported');
          },
        }),
      ) as never;
    },
  };
}

let db: PGlite;
let tenancy: Tenancy;

beforeEach(async () => {
  db = new PGlite();
  tenancy = new Tenancy(executor(db));
  await tenancy.init();
});

describe('tenants', () => {
  it('creates a tenant with a uuid id and active status', async () => {
    const t = await tenancy.createTenant({ name: 'Acme', country: 'ZA' });
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(t).toMatchObject({ name: 'Acme', country: 'ZA', status: 'active' });
  });
});

describe('API keys — issuance & authentication', () => {
  it('issues a key, returns the plaintext ONCE, and stores only a hash + last4', async () => {
    const { id } = await tenancy.createTenant({ name: 'Acme', country: 'ZA' });
    const key = await tenancy.issueApiKey({ tenantId: id, mode: 'test', scopes: ['escrows:write'] });

    expect(key.plaintext).toMatch(/^ck_test_[A-Za-z0-9_-]+$/);
    expect(key.last4).toBe(key.plaintext.slice(-4));
    expect(key.mode).toBe('test');

    // The stored secret is a sha256 hash, never the plaintext.
    const { rows } = await db.query<{ hash: string; last4: string }>(
      `select hash, last4 from api_keys where id = $1`,
      [key.id],
    );
    expect(rows[0]!.hash).toBe(createHash('sha256').update(key.plaintext).digest('hex'));
    expect(rows[0]!.hash).not.toContain(key.plaintext);
    expect(rows[0]!.last4).toBe(key.plaintext.slice(-4));
  });

  it('authenticates a valid key → tenant, mode, scopes', async () => {
    const { id } = await tenancy.createTenant({ name: 'Acme', country: 'ZA' });
    const key = await tenancy.issueApiKey({ tenantId: id, mode: 'test', scopes: ['escrows:write', 'payouts:read'] });

    const auth = await tenancy.authenticate(key.plaintext);
    expect(auth).toEqual({ tenantId: id, mode: 'test', scopes: ['escrows:write', 'payouts:read'] });
  });

  it('rejects an unknown/garbage key', async () => {
    expect(await tenancy.authenticate('ck_test_not_a_real_key')).toBeNull();
    expect(await tenancy.authenticate('')).toBeNull();
  });

  it('rejects a revoked key', async () => {
    const { id } = await tenancy.createTenant({ name: 'Acme', country: 'ZA' });
    const key = await tenancy.issueApiKey({ tenantId: id, mode: 'live', scopes: [] });
    expect(await tenancy.authenticate(key.plaintext)).not.toBeNull();

    await tenancy.revokeApiKey(key.id);
    expect(await tenancy.authenticate(key.plaintext)).toBeNull();
  });

  it('keeps test and live keys separate (mode reported per key)', async () => {
    const { id } = await tenancy.createTenant({ name: 'Acme', country: 'ZA' });
    const testKey = await tenancy.issueApiKey({ tenantId: id, mode: 'test', scopes: [] });
    const liveKey = await tenancy.issueApiKey({ tenantId: id, mode: 'live', scopes: [] });

    expect(testKey.plaintext.startsWith('ck_test_')).toBe(true);
    expect(liveKey.plaintext.startsWith('ck_live_')).toBe(true);
    expect((await tenancy.authenticate(testKey.plaintext))!.mode).toBe('test');
    expect((await tenancy.authenticate(liveKey.plaintext))!.mode).toBe('live');
  });
});
