export type Mode = 'sandbox' | 'live' | 'unknown';

/** API keys are mode-prefixed: ck_test_… (sandbox) / ck_live_… (production). */
export function modeFromKey(key: string): Mode {
  if (key.startsWith('ck_test_')) return 'sandbox';
  if (key.startsWith('ck_live_')) return 'live';
  return 'unknown';
}

/** Integer minor units → currency string with stable comma/dot grouping (e.g. "R 1,000.00"). */
export function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
