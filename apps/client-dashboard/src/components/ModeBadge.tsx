import type { ReactElement } from 'react';
import type { Mode } from '../lib/format';

/** Sandbox/live indicator — makes it unmistakable which environment a key is hitting. */
export function ModeBadge({ mode }: { mode: Mode }): ReactElement {
  const styles: Record<Mode, string> = {
    sandbox: 'bg-amber-100 text-amber-800',
    live: 'bg-emerald-100 text-emerald-800',
    unknown: 'bg-slate-100 text-slate-600',
  };
  const label = mode === 'sandbox' ? 'Sandbox' : mode === 'live' ? 'Live' : 'Unknown';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${styles[mode]}`}>{label}</span>;
}
