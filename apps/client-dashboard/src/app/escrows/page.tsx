import type { ReactElement } from 'react';
import { requireKey } from '../../lib/session';
import { makeClient } from '../../lib/client';
import { EscrowTable } from '../../components/EscrowTable';
import type { Escrow } from '../../lib/types';

export default async function EscrowsPage(): Promise<ReactElement> {
  const client = makeClient(await requireKey());
  const escrows = (await client.escrows.list()) as { data: Escrow[] };
  return (
    <section>
      <h1 className="font-heading mb-4 text-2xl font-bold text-foreground">Escrows</h1>
      <EscrowTable escrows={escrows.data} />
    </section>
  );
}
