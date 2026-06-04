import { Inject, Injectable } from '@nestjs/common';
import { SQL, type SqlExecutor } from '../db/sql';

export interface ReconciliationRow {
  currency: string;
  /** Funds we are custodian of per our ledger (escrow_held + recipient_payable), minor units. */
  ledgerMinor: number;
  /** The PSP's reported balance for the currency, minor units. */
  railMinor: number;
  /** ledger − rail. Non-zero = drift that needs investigation. */
  driftMinor: number;
  ok: boolean;
}

/**
 * Reconciles our double-entry ledger against the PSP (Korapay) balance per currency (M11). The sum of
 * `escrow_held + recipient_payable` is the money we're holding/owe — it should equal the funds resting
 * in the PSP balance. Drift beyond a tolerance is flagged for investigation/alerting.
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

  /** Compare ledger custody vs the PSP balances (minor units per currency); `toleranceMinor` allowed drift. */
  async reconcile(railBalances: Record<string, number>, toleranceMinor = 0): Promise<ReconciliationRow[]> {
    const ledger = await this.ledgerCustodyByCurrency();
    const currencies = new Set([...Object.keys(ledger), ...Object.keys(railBalances)]);
    const rows: ReconciliationRow[] = [];
    for (const currency of [...currencies].sort()) {
      const ledgerMinor = ledger[currency] ?? 0;
      const railMinor = railBalances[currency] ?? 0;
      const driftMinor = ledgerMinor - railMinor;
      rows.push({ currency, ledgerMinor, railMinor, driftMinor, ok: Math.abs(driftMinor) <= toleranceMinor });
    }
    return rows;
  }
}
