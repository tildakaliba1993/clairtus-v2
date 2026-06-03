import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { ClairtusClient, ClairtusApiError, verifyWebhookSignature } from '../src';

function fakeFetch(handler: (url: string, init: any) => { ok: boolean; status: number; json: unknown }) {
  const calls: { url: string; method: string; headers: any; body: any }[] = [];
  const fn = (async (url: string, init: any) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const r = handler(String(url), init);
    return { ok: r.ok, status: r.status, text: async () => JSON.stringify(r.json) } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const client = (fn: typeof fetch) => new ClairtusClient({ baseUrl: 'https://api.clairtus.example/v1', apiKey: 'ck_test_abc', fetchImpl: fn });

describe('ClairtusClient request shaping', () => {
  it('sends the bearer key and JSON body to the right URL', async () => {
    const { fn, calls } = fakeFetch(() => ({ ok: true, status: 201, json: { id: 'esc_1', status: 'DRAFT' } }));
    const res: any = await client(fn).escrows.create({ baseAmount: 100000, currency: 'ZAR', feeBps: 150, feeResponsibility: 'SELLER', sellerPartyId: 'p1' });
    expect(calls[0]!.url).toBe('https://api.clairtus.example/v1/escrows');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers.Authorization).toBe('Bearer ck_test_abc');
    expect(calls[0]!.body).toMatchObject({ baseAmount: 100000, sellerPartyId: 'p1' });
    expect(res.id).toBe('esc_1');
  });

  it('passes an Idempotency-Key when given', async () => {
    const { fn, calls } = fakeFetch(() => ({ ok: true, status: 200, json: {} }));
    await client(fn).escrows.fund('esc_1', { idempotencyKey: 'idem-1' });
    expect(calls[0]!.url).toBe('https://api.clairtus.example/v1/escrows/esc_1/fund');
    expect(calls[0]!.headers['Idempotency-Key']).toBe('idem-1');
  });

  it('throws ClairtusApiError carrying the error envelope', async () => {
    const { fn } = fakeFetch(() => ({ ok: false, status: 409, json: { error: { code: 'conflict', message: 'Illegal transition' } } }));
    await expect(client(fn).escrows.release('esc_1')).rejects.toMatchObject({ status: 409, code: 'conflict', message: 'Illegal transition' });
    await expect(client(fn).escrows.release('esc_1')).rejects.toBeInstanceOf(ClairtusApiError);
  });

  it('GET helpers hit the right paths', async () => {
    const { fn, calls } = fakeFetch(() => ({ ok: true, status: 200, json: { data: [] } }));
    await client(fn).balances();
    await client(fn).ledger();
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.clairtus.example/v1/balances',
      'https://api.clairtus.example/v1/ledger',
    ]);
  });
});

describe('verifyWebhookSignature (receiver helper)', () => {
  it('accepts a correctly signed body and rejects tampering', () => {
    const secret = 'whsec_x';
    const body = JSON.stringify({ id: 'evt_1', type: 'escrow.released' });
    const t = 1_780_000_000;
    const header = `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
    expect(verifyWebhookSignature(secret, body, header, 300, t)).toBe(true);
    expect(verifyWebhookSignature(secret, body + 'x', header, 300, t)).toBe(false);
    expect(verifyWebhookSignature(secret, body, header, 300, t + 9999)).toBe(false); // stale
  });
});
