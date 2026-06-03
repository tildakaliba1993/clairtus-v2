import type { ReactElement } from 'react';
import { requireKey } from '../lib/session';
import { makeClient } from '../lib/client';
import { BalanceCards } from '../components/BalanceCards';
import { EscrowTable } from '../components/EscrowTable';
import type { Balance, Escrow } from '../lib/types';

export default async function OverviewPage(): Promise<ReactElement> {
  const client = makeClient(await requireKey());
  const [balances, escrows] = await Promise.all([
    client.balances() as Promise<{ data: Balance[] }>,
    client.escrows.list() as Promise<{ data: Escrow[] }>,
  ]);

  return (
    <section className="space-y-10">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">Balances</h1>
        <p className="text-muted mb-4 text-sm">Money held, owed, and earned across your account.</p>
        <BalanceCards balances={balances.data} />
      </div>
      <div>
        <h2 className="font-heading mb-4 text-xl font-semibold text-foreground">Recent escrows</h2>
        <EscrowTable escrows={escrows.data.slice(0, 5)} />
      </div>
    </section>
  );
}
