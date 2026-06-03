import type { ReactElement } from 'react';
import { formatMoney } from '../lib/format';
import type { Balance } from '../lib/types';

const TYPE_LABELS: Record<string, string> = {
  escrow_held: 'Held in escrow',
  recipient_payable: 'Owed to recipients',
  clairtus_revenue: 'Platform fees',
  tenant_payable: 'Your commission',
  external: 'Rail (net in/out)',
};

export function BalanceCards({ balances }: { balances: Balance[] }): ReactElement {
  if (balances.length === 0) {
    return <p className="text-muted text-sm">No balances yet — fund an escrow to see money here.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {balances.map((b) => (
        <div key={b.accountId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-muted text-xs font-medium uppercase tracking-wide">
            {TYPE_LABELS[b.type] ?? b.type} · {b.currency}
          </div>
          <div className="mt-1 font-mono text-xl font-semibold text-foreground">{formatMoney(b.balance, b.currency)}</div>
        </div>
      ))}
    </div>
  );
}
