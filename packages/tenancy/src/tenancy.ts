import { createHash, randomBytes } from 'node:crypto';
import { TENANCY_SCHEMA, TENANT_CONTEXT_VAR } from './schema';

/**
 * Minimal SQL executor the Tenancy service runs against — implemented by pglite in
 * tests and a Postgres/Supabase adapter in prod. Identical shape to the Ledger's, so
 * a single connection adapter can serve both. Database-agnostic by design.
 */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

export type ApiKeyMode = 'test' | 'live';

export interface Tenant {
  id: string;
  name: string;
  country: string | null;
  status: string;
  createdAt: string;
}

export interface IssuedApiKey {
  id: string;
  /** The full secret — returned ONCE at issuance and never stored in plaintext. */
  plaintext: string;
  last4: string;
  mode: ApiKeyMode;
}

export interface AuthContext {
  tenantId: string;
  mode: ApiKeyMode;
  scopes: string[];
}

/** Safe API-key metadata for listing — never includes the plaintext or hash. */
export interface ApiKeySummary {
  id: string;
  mode: ApiKeyMode;
  last4: string;
  scopes: string[];
  createdAt: string;
  revokedAt: string | null;
  active: boolean;
}

/** sha256 hex — what we persist instead of the raw key. */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/** Generate a fresh secret like `ck_test_…` / `ck_live_…` (url-safe, 24 random bytes). */
export function generateApiKey(mode: ApiKeyMode): string {
  return `ck_${mode}_${randomBytes(24).toString('base64url')}`;
}

/**
 * Run `fn` inside a transaction with the tenant context set, so RLS policies scope every
 * query to `tenantId`. Role-agnostic: the connection's role (Supabase `authenticated`, or
 * a restricted role in tests) supplies the enforcement; this only sets the GUC.
 */
export function withTenant<T>(
  sql: SqlExecutor,
  tenantId: string,
  fn: (tx: SqlExecutor) => Promise<T>,
): Promise<T> {
  return sql.transaction(async (tx) => {
    await tx.query(`select set_config('${TENANT_CONTEXT_VAR}', $1, true)`, [tenantId]);
    return fn(tx);
  });
}

export class Tenancy {
  constructor(private readonly sql: SqlExecutor) {}

  /** Creates the tenancy tables if absent (idempotent). */
  async init(): Promise<void> {
    for (const stmt of TENANCY_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
      await this.sql.query(stmt);
    }
  }

  async createTenant(input: { name: string; country?: string | null }): Promise<Tenant> {
    const { rows } = await this.sql.query<{
      id: string; name: string; country: string | null; status: string; created_at: string;
    }>(
      `insert into tenants (name, country) values ($1, $2)
       returning id, name, country, status, created_at`,
      [input.name, input.country ?? null],
    );
    const r = rows[0]!;
    return { id: r.id, name: r.name, country: r.country, status: r.status, createdAt: r.created_at };
  }

  /** Issues a new API key. The plaintext is returned ONCE; only its hash is stored. */
  async issueApiKey(input: {
    tenantId: string;
    mode: ApiKeyMode;
    scopes?: string[];
  }): Promise<IssuedApiKey> {
    const plaintext = generateApiKey(input.mode);
    const scopes = input.scopes ?? [];
    const { rows } = await this.sql.query<{ id: string }>(
      `insert into api_keys (tenant_id, mode, hash, last4, scopes)
       values ($1, $2, $3, $4, $5::jsonb)
       returning id`,
      [input.tenantId, input.mode, hashApiKey(plaintext), plaintext.slice(-4), JSON.stringify(scopes)],
    );
    return { id: rows[0]!.id, plaintext, last4: plaintext.slice(-4), mode: input.mode };
  }

  /** Resolves a plaintext key to its tenant context, or null if unknown/revoked. */
  async authenticate(plaintext: string): Promise<AuthContext | null> {
    if (!plaintext) return null;
    const { rows } = await this.sql.query<{
      tenant_id: string; mode: ApiKeyMode; scopes: string[] | null;
    }>(
      `select tenant_id, mode, scopes from api_keys
       where hash = $1 and revoked_at is null`,
      [hashApiKey(plaintext)],
    );
    if (rows.length === 0) return null;
    const r = rows[0]!;
    return { tenantId: r.tenant_id, mode: r.mode, scopes: r.scopes ?? [] };
  }

  /** Revoke a key. When `tenantId` is given, only revokes a key belonging to that tenant (safe for the API). */
  async revokeApiKey(id: string, tenantId?: string): Promise<boolean> {
    const where = tenantId ? `where id = $1 and tenant_id = $2 and revoked_at is null` : `where id = $1 and revoked_at is null`;
    const params = tenantId ? [id, tenantId] : [id];
    const { rows } = await this.sql.query<{ id: string }>(
      `update api_keys set revoked_at = now() ${where} returning id`,
      params,
    );
    return rows.length > 0;
  }

  /** List a tenant's API keys (metadata only — never the plaintext or hash). */
  async listApiKeys(tenantId: string): Promise<ApiKeySummary[]> {
    const { rows } = await this.sql.query<{
      id: string; mode: ApiKeyMode; last4: string; scopes: string[] | null; created_at: string; revoked_at: string | null;
    }>(
      `select id, mode, last4, scopes, created_at, revoked_at
       from api_keys where tenant_id = $1 order by created_at desc`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: r.id, mode: r.mode, last4: r.last4, scopes: r.scopes ?? [],
      createdAt: r.created_at, revokedAt: r.revoked_at, active: r.revoked_at === null,
    }));
  }
}
