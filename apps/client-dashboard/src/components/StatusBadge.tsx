import type { ReactElement } from 'react';

/** Maps escrow/payout statuses to brand-consistent pill styles (Tailwind v4). */
const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  AWAITING_FUNDING: 'bg-amber-100 text-amber-800',
  FUNDED: 'bg-primary/10 text-primary',
  RELEASED: 'bg-emerald-100 text-emerald-800',
  REFUNDED: 'bg-slate-100 text-slate-700',
  DISPUTED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-slate-100 text-slate-500',
  succeeded: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-800',
};

export function StatusBadge({ status }: { status: string }): ReactElement {
  const cls = STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{status}</span>
  );
}
