import type { ReactElement } from 'react';
import { requireKey } from '../../lib/session';
import { makeClient } from '../../lib/client';
import { formatMoney, shortId } from '../../lib/format';
import { StatusBadge } from '../../components/StatusBadge';
import type { Payout } from '../../lib/types';

export default async function PayoutsPage(): Promise<ReactElement> {
  const client = makeClient(await requireKey());
  const payouts = (await client.payouts.list()) as { data: Payout[] };

  return (
    <section>
      <h1 className="font-heading mb-4 text-2xl font-bold text-foreground">Payouts</h1>
      {payouts.data.length === 0 ? (
        <p className="text-muted text-sm">No payouts yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-muted border-b border-slate-200 text-xs uppercase tracking-wide">
            <tr>
              <th className="py-2 pr-4 font-medium">Payout</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Amount</th>
              <th className="py-2 pr-4 font-medium">Rail</th>
            </tr>
          </thead>
          <tbody>
            {payouts.data.map((p) => (
              <tr key={p.id} className="border-b border-slate-100">
                <td className="py-2 pr-4 font-mono">{shortId(p.id)}</td>
                <td className="py-2 pr-4"><StatusBadge status={p.status} /></td>
                <td className="py-2 pr-4 font-mono">{formatMoney(p.amount, p.currency)}</td>
                <td className="text-muted py-2 pr-4">{p.rail ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
