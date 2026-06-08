import { Inject, Injectable } from '@nestjs/common';
import { SQL, type SqlExecutor } from '../db/sql';

export interface AuditEntry {
  tenantId: string;
  /** Dotted action, e.g. 'escrow.released', 'payout.created', 'apikey.issued'. */
  action: string;
  /** 'escrow' | 'payout' | 'party' | 'apikey' | 'tenant'. */
  resourceType: string;
  resourceId?: string | null;
  escrowId?: string | null;
  actor?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Writes the immutable, append-only audit log (architecture §14). One row per money operation and
 * admin action; never updated or deleted. Queryable by tenant + escrow. Reused across the lifecycle.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(SQL) private readonly sql: SqlExecutor) {}

  /** Pass `executor` to write the audit row inside a caller's transaction (atomic with the money op). */
  async record(entry: AuditEntry, executor: SqlExecutor = this.sql): Promise<void> {
    await executor.query(
      `insert into audit_log (tenant_id, action, resource_type, resource_id, escrow_id, actor, metadata)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        entry.tenantId,
        entry.action,
        entry.resourceType,
        entry.resourceId ?? null,
        entry.escrowId ?? null,
        entry.actor ?? 'system',
        JSON.stringify(entry.metadata ?? {}),
      ],
    );
  }

  /** Read an escrow's audit trail (most recent first) — for support/ops and the M5 audit gate. */
  async listForEscrow(tenantId: string, escrowId: string): Promise<AuditEntry[]> {
    const { rows } = await this.sql.query<{ action: string; resource_type: string; resource_id: string | null; escrow_id: string | null; actor: string | null; metadata: Record<string, unknown> }>(
      `select action, resource_type, resource_id, escrow_id, actor, metadata
       from audit_log where tenant_id = $1 and escrow_id = $2 order by created_at`,
      [tenantId, escrowId],
    );
    return rows.map((r) => ({
      tenantId,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      escrowId: r.escrow_id,
      actor: r.actor,
      metadata: r.metadata,
    }));
  }
}
