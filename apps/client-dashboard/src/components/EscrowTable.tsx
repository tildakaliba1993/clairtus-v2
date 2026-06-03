import type { ReactElement } from 'react';
import { formatMoney, shortId } from '../lib/format';
import type { Escrow } from '../lib/types';
import { StatusBadge } from './StatusBadge';

export function EscrowTable({ escrows }: { escrows: Escrow[] }): ReactElement {
  if (escrows.length === 0) {
    return <p className="text-muted text-sm">No escrows yet.</p>;
  }
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-muted border-b border-slate-200 text-xs uppercase tracking-wide">
        <tr>
          <th className="py-2 pr-4 font-medium">Escrow</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 pr-4 font-medium">Amount</th>
          <th className="py-2 pr-4 font-medium">Fee borne by</th>
        </tr>
      </thead>
      <tbody>
        {escrows.map((e) => (
          <tr key={e.id} className="border-b border-slate-100">
            <td className="py-2 pr-4">
              <a href={`/escrows/${e.id}`} className="font-mono text-primary hover:underline">{shortId(e.id)}</a>
            </td>
            <td className="py-2 pr-4"><StatusBadge status={e.status} /></td>
            <td className="py-2 pr-4 font-mono">{formatMoney(e.baseAmount, e.currency)}</td>
            <td className="text-muted py-2 pr-4">{e.feeResponsibility}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
