import { Inject, Injectable } from '@nestjs/common';
import { SQL, type SqlExecutor } from '../db/sql';

/** A PSP balance for one currency, minor units. Korapay settles to `available` but parks funds in
 *  `pending` first — both are ours, so reconciliation counts their sum. */
export interface RailBalanceMinor {
  available: number;
  pending: number;
}

export interface ReconciliationRow {
  currency: string;
  /** Funds we are custodian of per our ledger (escrow_held + recipient_payable), minor units. */
  ledgerMinor: number;
  /** The PSP balance we reconcile against = available + pending, minor units. */
  railMinor: number;
  /** PSP balance breakdown (minor units). */
  availableMinor: number;
  pendingMinor: number;
  /** Total PSP fees recorded in the ledger (`psp_fees`) for the currency — informational, NOT drift. */
  feesMinor: number;
  /** ledger − rail. Non-zero = drift that needs investigation. */
  driftMinor: number;
  ok: boolean;
}

/**
 * Reconciles our double-entry ledger against the PSP (Korapay) balance per currency (M11 + B3). The sum
 * of `escrow_held + recipient_payable` is the money we're holding/owe — it should equal the PSP funds
 * resting in **available + pending** (Korapay parks settlements in pending before they clear; comparing
 * to available-only flags false drift). Since A3 the ledger holds the net-of-fees amount, matching the
 * net PSP balance; the PSP fee total (`psp_fees`) is surfaced for visibility but not counted as drift.
 * Drift beyond a tolerance is flagged for investigation/alerting.
 */
@Injectable()
export class ReconciliationService {
  constructor(@Inject(SQL) private readonly sql: SqlExecutor) {}

  /** Ledger custody obligation per currency (minor units), summed across all tenants. */
  async ledgerCustodyByCurrency(): Promise<Record<string, number>> {
    const { rows } = await this.sql.query<{ currency: string; balance: string | number }>(
      `select a.currency,
              coalesce(sum(case when e.direction = 'credit' then e.amount else -e.amount end), 0)::bigint as balance
       from ledger_entries e
       join ledger_accounts a on a.id = e.account_id
       where a.type in ('escrow_held', 'recipient_payable')
       group by a.currency`,
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[r.currency] = Number(r.balance);
    return out;
  }

  /** Total PSP fees booked to `psp_fees` per currency (minor units), summed across all tenants. */
  async pspFeesByCurrency(): Promise<Record<string, number>> {
    const { rows } = await this.sql.query<{ currency: string; balance: string | number }>(
      `select a.currency,
              coalesce(sum(case when e.direction = 'credit' then e.amount else -e.amount end), 0)::bigint as balance
       from ledger_entries e
       join ledger_accounts a on a.id = e.account_id
       where a.type = 'psp_fees'
       group by a.currency`,
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[r.currency] = Number(r.balance);
    return out;
  }

  /**
   * Compare ledger custody vs the PSP balances per currency. `railBalances` carries available + pending
   * (both are reconciled against custody). `toleranceMinor` is the allowed absolute drift.
   */
  async reconcile(railBalances: Record<string, RailBalanceMinor>, toleranceMinor = 0): Promise<ReconciliationRow[]> {
    const ledger = await this.ledgerCustodyByCurrency();
    const fees = await this.pspFeesByCurrency();
    const currencies = new Set([...Object.keys(ledger), ...Object.keys(railBalances)]);
    const rows: ReconciliationRow[] = [];
    for (const currency of [...currencies].sort()) {
      const ledgerMinor = ledger[currency] ?? 0;
      const bal = railBalances[currency] ?? { available: 0, pending: 0 };
      const availableMinor = bal.available ?? 0;
      const pendingMinor = bal.pending ?? 0;
      const railMinor = availableMinor + pendingMinor;
      const driftMinor = ledgerMinor - railMinor;
      rows.push({
        currency, ledgerMinor, railMinor, availableMinor, pendingMinor,
        feesMinor: fees[currency] ?? 0,
        driftMinor, ok: Math.abs(driftMinor) <= toleranceMinor,
      });
    }
    return rows;
  }
}
