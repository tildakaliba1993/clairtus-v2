import { Inject, Injectable } from '@nestjs/common';
import { Tenancy, type ApiKeySummary } from '@clairtus/tenancy';
import { SQL, type SqlExecutor } from '../db/sql';
import { AuditService } from '../audit/audit.service';
import { DEFAULT_WRITE_SCOPES } from '../common/scopes';
import type { SessionUser } from './session';

export interface ProvisionResult {
  tenantId: string;
  /** true if this call created the tenant (and the keys below are returned ONCE). */
  provisioned: boolean;
  testKey?: string;
  liveKey?: string;
}

export interface TenantForUser {
  tenantId: string;
  email: string | null;
  keys: ApiKeySummary[];
}

/**
 * Self-serve provisioning (Phase 3): the first time an authenticated user signs up, create their
 * tenant + test/live keys and link the auth user → tenant. Idempotent — a returning user just gets
 * their existing tenant (keys are not re-leaked).
 */
@Injectable()
export class SignupService {
  constructor(
    @Inject(SQL) private readonly sql: SqlExecutor,
    private readonly tenancy: Tenancy,
    private readonly audit: AuditService,
  ) {}

  async provision(user: SessionUser): Promise<ProvisionResult> {
    const existing = await this.byAuthUser(user.userId);
    if (existing) return { tenantId: existing, provisioned: false };

    const name = user.email ?? `tenant-${user.userId.slice(0, 8)}`;
    const tenant = await this.tenancy.createTenant({ name, country: null });
    const testKey = await this.tenancy.issueApiKey({ tenantId: tenant.id, mode: 'test', scopes: DEFAULT_WRITE_SCOPES });
    const liveKey = await this.tenancy.issueApiKey({ tenantId: tenant.id, mode: 'live', scopes: DEFAULT_WRITE_SCOPES });

    const ins = await this.sql.query<{ tenant_id: string }>(
      `insert into tenant_users (tenant_id, auth_user_id, email, role)
       values ($1, $2, $3, 'admin') on conflict (auth_user_id) do nothing returning tenant_id`,
      [tenant.id, user.userId, user.email ?? null],
    );
    if (ins.rows.length === 0) {
      // Lost a race — another concurrent signup won; return that tenant (our just-created one is orphaned).
      return { tenantId: (await this.byAuthUser(user.userId))!, provisioned: false };
    }

    await this.audit.record({ tenantId: tenant.id, action: 'tenant.created', resourceType: 'tenant', resourceId: tenant.id, actor: 'self-serve', metadata: { email: user.email, authUserId: user.userId } });
    await this.audit.record({ tenantId: tenant.id, action: 'apikey.issued', resourceType: 'apikey', resourceId: testKey.id, actor: 'self-serve', metadata: { mode: 'test', last4: testKey.last4 } });
    await this.audit.record({ tenantId: tenant.id, action: 'apikey.issued', resourceType: 'apikey', resourceId: liveKey.id, actor: 'self-serve', metadata: { mode: 'live', last4: liveKey.last4 } });

    return { tenantId: tenant.id, provisioned: true, testKey: testKey.plaintext, liveKey: liveKey.plaintext };
  }

  async getByUser(userId: string): Promise<TenantForUser | null> {
    const { rows } = await this.sql.query<{ tenant_id: string; email: string | null }>(
      `select tenant_id, email from tenant_users where auth_user_id = $1`,
      [userId],
    );
    const row = rows[0];
    if (!row) return null;
    return { tenantId: row.tenant_id, email: row.email, keys: await this.tenancy.listApiKeys(row.tenant_id) };
  }

  private async byAuthUser(userId: string): Promise<string | null> {
    const { rows } = await this.sql.query<{ tenant_id: string }>(
      `select tenant_id from tenant_users where auth_user_id = $1`,
      [userId],
    );
    return rows[0]?.tenant_id ?? null;
  }
}
