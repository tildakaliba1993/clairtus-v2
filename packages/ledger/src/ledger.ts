import { LEDGER_SCHEMA } from './schema';

export type AccountType =
  | 'escrow_held'
  | 'recipient_payable'
  | 'tenant_payable'
  | 'clairtus_revenue'
  | 'psp_fees'
  | 'external';

export type Direction = 'debit' | 'credit';

export interface LedgerAccount {
  id: string;
  tenantId: string;
  type: AccountType;
  ownerRef: string | null;
  currency: string;
}

export interface EntryInput {
  accountId: string;
  direction: Direction;
  amount: number; // positive integer, minor units
}

export interface PostingGroupInput {
  tenantId: string;
  /** Idempotency key — re-posting the same (tenant, reference) is a no-op. */
  reference: string;
  currency: string;
  entries: EntryInput[];
  escrowId?: string;
}

export class LedgerError extends Error {}

/**
 * Minimal SQL executor the Ledger runs against. Implemented by pglite in tests
 * and by a Postgres/Supabase adapter in production — the Ledger itself is
 * database-agnostic.
 */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

export class Ledger {
  constructor(private readonly sql: SqlExecutor) {}

  /** Creates the ledger tables if absent (idempotent). */
  async init(): Promise<void> {
    for (const stmt of LEDGER_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
      await this.sql.query(stmt);
    }
  }

  async createAccount(input: {
    tenantId: string;
    type: AccountType;
    currency: string;
    ownerRef?: string | null;
  }): Promise<LedgerAccount> {
    const { rows } = await this.sql.query<{
      id: string; tenant_id: string; type: AccountType; owner_ref: string | null; currency: string;
    }>(
      `insert into ledger_accounts (tenant_id, type, owner_ref, currency)
       values ($1, $2, $3, $4)
       returning id, tenant_id, type, owner_ref, currency`,
      [input.tenantId, input.type, input.ownerRef ?? null, input.currency],
    );
    const r = rows[0]!;
    return { id: r.id, tenantId: r.tenant_id, type: r.type, ownerRef: r.owner_ref, currency: r.currency };
  }

  /**
   * Posts a balanced group of entries atomically.
   * INVARIANT: sum(debits) === sum(credits). Idempotent by (tenant, reference).
   *
   * Pass `executor` to run within a caller-supplied transaction (no new transaction is opened) so the
   * post can be committed atomically with other work — e.g. its audit-log row. Without it, the post
   * runs in its own transaction as before.
   */
  async post(group: PostingGroupInput, executor?: SqlExecutor): Promise<{ postingGroupId: string; created: boolean }> {
    if (group.entries.length < 2) {
      throw new LedgerError('a posting group needs at least two entries');
    }
    let debit = 0;
    let credit = 0;
    for (const e of group.entries) {
      if (!Number.isInteger(e.amount) || e.amount <= 0) {
        throw new LedgerError('entry amount must be a positive integer (minor units)');
      }
      if (e.direction === 'debit') debit += e.amount;
      else credit += e.amount;
    }
    if (debit !== credit) {
      throw new LedgerError(`posting group does not balance: debits ${debit} != credits ${credit}`);
    }

    const run = async (tx: SqlExecutor): Promise<{ postingGroupId: string; created: boolean }> => {
      const existing = await tx.query<{ id: string }>(
        `select id from ledger_posting_groups where tenant_id = $1 and reference = $2`,
        [group.tenantId, group.reference],
      );
      if (existing.rows.length > 0) {
        return { postingGroupId: existing.rows[0]!.id, created: false };
      }

      const pg = await tx.query<{ id: string }>(
        `insert into ledger_posting_groups (tenant_id, reference, escrow_id, currency)
         values ($1, $2, $3, $4) returning id`,
        [group.tenantId, group.reference, group.escrowId ?? null, group.currency],
      );
      const postingGroupId = pg.rows[0]!.id;

      for (const e of group.entries) {
        await tx.query(
          `insert into ledger_entries (posting_group_id, account_id, direction, amount)
           values ($1, $2, $3, $4)`,
          [postingGroupId, e.accountId, e.direction, e.amount],
        );
      }
      return { postingGroupId, created: true };
    };

    return executor ? run(executor) : this.sql.transaction(run);
  }

  /** Derived balance = sum(credits) − sum(debits), in minor units. */
  async getBalance(accountId: string): Promise<number> {
    const { rows } = await this.sql.query<{ balance: string | number }>(
      `select coalesce(sum(case when direction = 'credit' then amount else -amount end), 0)::bigint as balance
       from ledger_entries where account_id = $1`,
      [accountId],
    );
    return Number(rows[0]!.balance);
  }

  /**
   * Reverses a posting group by posting its mirror image under a new reference. Pass `executor` to run
   * within a caller's transaction (e.g. atomic with the reversal's audit row).
   */
  async reverse(
    postingGroupId: string,
    reference: string,
    tenantId: string,
    executor?: SqlExecutor,
  ): Promise<{ postingGroupId: string }> {
    const db = executor ?? this.sql;
    const { rows: entries } = await db.query<{
      account_id: string; direction: Direction; amount: string | number;
    }>(
      `select account_id, direction, amount from ledger_entries where posting_group_id = $1`,
      [postingGroupId],
    );
    if (entries.length === 0) throw new LedgerError('posting group not found');

    const { rows: grp } = await db.query<{ currency: string; escrow_id: string | null }>(
      `select currency, escrow_id from ledger_posting_groups where id = $1`,
      [postingGroupId],
    );

    const reversed: EntryInput[] = entries.map((e) => ({
      accountId: e.account_id,
      direction: e.direction === 'debit' ? 'credit' : 'debit',
      amount: Number(e.amount),
    }));

    const res = await this.post({
      tenantId,
      reference,
      currency: grp[0]!.currency,
      escrowId: grp[0]!.escrow_id ?? undefined,
      entries: reversed,
    }, executor);
    return { postingGroupId: res.postingGroupId };
  }
}
