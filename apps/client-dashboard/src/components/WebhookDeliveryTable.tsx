import type { ReactElement } from 'react';
import type { WebhookDelivery } from '../lib/types';
import { StatusBadge } from './StatusBadge';

export function WebhookDeliveryTable({ deliveries }: { deliveries: WebhookDelivery[] }): ReactElement {
  if (deliveries.length === 0) {
    return <p className="text-muted text-sm">No webhook deliveries yet.</p>;
  }
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-muted border-b border-slate-200 text-xs uppercase tracking-wide">
        <tr>
          <th className="py-2 pr-4 font-medium">Event</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 pr-4 font-medium">Attempts</th>
        </tr>
      </thead>
      <tbody>
        {deliveries.map((d) => (
          <tr key={d.id} className="border-b border-slate-100">
            <td className="py-2 pr-4 font-mono">{d.event_type}</td>
            <td className="py-2 pr-4"><StatusBadge status={d.status === 'delivered' ? 'succeeded' : d.status === 'failed' ? 'failed' : 'pending'} /></td>
            <td className="text-muted py-2 pr-4">{d.attempts}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
