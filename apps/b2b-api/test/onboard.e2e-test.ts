import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Tenancy, type SqlExecutor } from '@clairtus/tenancy';
import { WebhookService } from '../src/webhooks/webhook.service';
import { AuditService } from '../src/audit/audit.service';
import { applyAllSchema } from '../src/db/schema';
import { onboardTenant } from '../src/onboarding/onboard';

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

const stubFetch = (async () => ({ ok: true, status: 200 }) as Response) as unknown as typeof fetch;

let tenancy: Tenancy;
let webhooks: WebhookService;
let sql: SqlExecutor;

beforeEach(async () => {
  const db = new PGlite();
  sql = executor(db);
  await applyAllSchema(sql);
  tenancy = new Tenancy(sql);
  webhooks = new WebhookService(sql, stubFetch);
});

describe('onboardTenant (design-partner onboarding kit)', () => {
  it('creates a tenant, issues test+live keys, and registers a webhook endpoint', async () => {
    const result = await onboardTenant({ tenancy, webhooks }, {
      name: 'Acme SA', country: 'ZA', webhookUrl: 'https://acme.example/webhooks/clairtus',
    });

    expect(result.tenantId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.testKey.startsWith('ck_test_')).toBe(true);
    expect(result.liveKey.startsWith('ck_live_')).toBe(true);
    expect(result.webhook?.signingSecret.startsWith('whsec_')).toBe(true);

    // The issued keys actually authenticate, with the right mode + scopes.
    const testAuth = await tenancy.authenticate(result.testKey);
    expect(testAuth).toMatchObject({ tenantId: result.tenantId, mode: 'test' });
    expect(testAuth!.scopes).toContain('escrows:write');
    expect((await tenancy.authenticate(result.liveKey))!.mode).toBe('live');
  });

  it('skips the webhook when no URL is configured', async () => {
    const result = await onboardTenant({ tenancy, webhooks }, { name: 'No Hook', country: 'NG' });
    expect(result.webhook).toBeUndefined();
    expect(result.testKey.startsWith('ck_test_')).toBe(true);
  });

  it('audits tenant creation + key issuance when an audit sink is provided (PR-5.3)', async () => {
    const audit = new AuditService(sql);
    const result = await onboardTenant({ tenancy, webhooks, audit }, { name: 'Audited', country: 'ZA' });
    const rows = await sql.query<{ action: string; metadata: { last4?: string } }>(
      `select action, metadata from audit_log where tenant_id = $1 order by created_at`,
      [result.tenantId],
    );
    const actions = rows.rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['tenant.created', 'apikey.issued', 'apikey.issued']));
    // Plaintext keys are never logged — only last4.
    expect(rows.rows.every((r) => !JSON.stringify(r.metadata).includes('ck_'))).toBe(true);
  });
});
