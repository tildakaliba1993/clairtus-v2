import type { ReactElement } from 'react';
import { requireKey } from '../../lib/session';
import { makeClient } from '../../lib/client';
import { WebhookDeliveryTable } from '../../components/WebhookDeliveryTable';
import type { WebhookDelivery } from '../../lib/types';

export default async function WebhooksPage(): Promise<ReactElement> {
  const client = makeClient(await requireKey());
  const deliveries = (await client.webhookDeliveries.list()) as { data: WebhookDelivery[] };

  return (
    <section>
      <h1 className="font-heading mb-1 text-2xl font-bold text-foreground">Webhook deliveries</h1>
      <p className="text-muted mb-4 text-sm">Signed events we&apos;ve sent to your endpoints, with retry status.</p>
      <WebhookDeliveryTable deliveries={deliveries.data} />
    </section>
  );
}
