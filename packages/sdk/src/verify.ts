import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify an inbound Clairtus webhook signature (receiver side).
 * Header form: `X-Clairtus-Signature: t=<unix>,v1=<hex>` over `${t}.${rawBody}`.
 * Pass the RAW request body string (not re-serialized JSON) for a correct compare.
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  header: string,
  toleranceSeconds = 300,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const t = Number(parts.t);
  const provided = parts.v1;
  if (!Number.isFinite(t) || !provided) return false;
  if (Math.abs(now - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
