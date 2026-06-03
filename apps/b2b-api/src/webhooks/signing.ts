import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stripe-style webhook signatures: HMAC-SHA256 over `${timestamp}.${body}` with the
 * endpoint's signing secret, carried as `X-Clairtus-Signature: t=<unix>,v1=<hex>`.
 * Including the timestamp lets receivers reject replays outside a tolerance window.
 */
export function signWebhook(secret: string, body: string, timestamp: number): string {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

/** Verify a signature header (used by receivers / the SDK). Constant-time compare. */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
  toleranceSeconds = 300,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const t = Number(parts.t);
  const provided = parts.v1;
  if (!Number.isFinite(t) || !provided) return false;
  if (Math.abs(now - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The outbound event catalog. */
export const WEBHOOK_EVENTS = [
  'escrow.funded',
  'escrow.released',
  'escrow.refunded',
  'escrow.cancelled',
  'escrow.disputed',
  'payout.succeeded',
  'payout.failed',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];
