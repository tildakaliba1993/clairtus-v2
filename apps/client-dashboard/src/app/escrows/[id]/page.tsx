import type { ReactElement } from 'react';
import Link from 'next/link';
import { requireKey } from '../../../lib/session';
import { makeClient } from '../../../lib/client';
import { formatMoney } from '../../../lib/format';
import { StatusBadge } from '../../../components/StatusBadge';
import type { Escrow } from '../../../lib/types';

export default async function EscrowDetailPage({ params }: { params: Promise<{ id: string }> }): Promise<ReactElement> {
  const { id } = await params;
  const client = makeClient(await requireKey());
  const e = (await client.escrows.get(id)) as Escrow & { updatedAt?: string };

  const rows: [string, ReactElement | string][] = [
    ['Status', <StatusBadge key="s" status={e.status} />],
    ['Amount', formatMoney(e.baseAmount, e.currency)],
    ['Currency', e.currency],
    ['Fee borne by', e.feeResponsibility],
    ['Seller party', e.sellerPartyId],
    ['Created', e.createdAt],
  ];

  return (
    <section className="max-w-2xl">
      <Link href="/escrows" className="text-muted text-sm hover:text-foreground">← Escrows</Link>
      <h1 className="font-heading mt-2 font-mono text-xl font-bold text-foreground">{e.id}</h1>
      <dl className="mt-6 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between px-4 py-3">
            <dt className="text-muted text-sm">{label}</dt>
            <dd className="text-sm font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
