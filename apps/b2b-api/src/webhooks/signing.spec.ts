import { describe, it, expect } from 'vitest';
import { signWebhook, verifyWebhookSignature } from './signing';

const SECRET = 'whsec_test';
const body = JSON.stringify({ id: 'evt_1', type: 'escrow.funded' });

describe('webhook signing', () => {
  it('signs and verifies a payload', () => {
    const ts = 1_780_000_000;
    const header = signWebhook(SECRET, body, ts);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(SECRET, body, header, 300, ts)).toBe(true);
  });

  it('rejects a tampered body or wrong secret', () => {
    const ts = 1_780_000_000;
    const header = signWebhook(SECRET, body, ts);
    expect(verifyWebhookSignature(SECRET, body + 'x', header, 300, ts)).toBe(false);
    expect(verifyWebhookSignature('wrong', body, header, 300, ts)).toBe(false);
  });

  it('rejects a stale timestamp outside tolerance', () => {
    const ts = 1_780_000_000;
    const header = signWebhook(SECRET, body, ts);
    expect(verifyWebhookSignature(SECRET, body, header, 300, ts + 301)).toBe(false);
    expect(verifyWebhookSignature(SECRET, body, header, 300, ts + 299)).toBe(true);
  });
});
