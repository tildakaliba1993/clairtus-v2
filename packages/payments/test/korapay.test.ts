import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  KorapayRail,
  toMajorAmount,
  type PayInRequest,
  type PayoutRequest,
} from '../src';

/**
 * A fake fetch that records calls and returns canned JSON (contract-test harness),
 * mirroring the PawaPay test harness. Korapay wraps payloads as { status, message, data }.
 */
function fakeFetch(json: unknown, ok = true, status = 200) {
  const calls: { url: string; method?: string; body: any; headers: any }[] = [];
  const fn = (async (url: string, init?: { method?: string; body?: string; headers?: any }) => {
    calls.push({
      url: String(url),
      method: init?.method,
      body: init?.body ? JSON.parse(init.body) : undefined,
      headers: init?.headers,
    });
    return {
      ok, status,
      json: async () => json,
      text: async () => JSON.stringify(json),
    } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const SECRET = 'sk_test_secret';
const cfg = (fetchImpl: typeof fetch) => ({
  baseUrl: 'https://api.korapay.com',
  secretKey: SECRET,
  notificationUrl: 'https://example.com/webhooks/korapay',
  fetchImpl,
});

describe('amount conversion (minor → Korapay major-unit number)', () => {
  it('converts integer minor units to a 2dp major number', () => {
    expect(toMajorAmount(150000)).toBe(1500);     // 150,000 minor → 1500.00
    expect(toMajorAmount(98500)).toBe(985);       // 98,500 → 985.00
    expect(toMajorAmount(10099)).toBe(100.99);    // 10,099 → 100.99
  });
});

describe('capabilities', () => {
  it('supports hold (funds rest in balance), bank_transfer + card, ZA/NG', () => {
    const rail = new KorapayRail(cfg(fakeFetch({}).fn));
    expect(rail.id).toBe('korapay');
    expect(rail.capabilities.hold).toBe(true);
    expect(rail.capabilities.payIn).toBe(true);
    expect(rail.capabilities.payOut).toBe(true);
    expect(rail.capabilities.methods).toContain('bank_transfer');
    expect(rail.capabilities.countries).toContain('ZA');
  });
});

describe('initiatePayIn', () => {
  it('builds a bank-transfer charge from minor units and maps the virtual account', async () => {
    const { fn, calls } = fakeFetch({
      status: true,
      message: 'Bank transfer initiated successfully',
      data: {
        reference: 'escrow-1',
        currency: 'NGN',
        amount: 1500,
        status: 'processing',
        bank_account: {
          account_name: 'Demo account',
          account_number: '7590031627',
          bank_name: 'wema',
          bank_code: '035',
        },
      },
    });
    const rail = new KorapayRail(cfg(fn));
    const req: PayInRequest = {
      reference: 'escrow-1', amount: 150000, currency: 'NGN', country: 'NG',
      method: 'bank_transfer', payer: { name: 'John Doe' }, metadata: { email: 'john@example.com' },
    };
    const res = await rail.initiatePayIn(req);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('https://api.korapay.com/merchant/api/v1/charges/bank-transfer');
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(calls[0]!.body).toMatchObject({
      reference: 'escrow-1', amount: 1500, currency: 'NGN',
      notification_url: 'https://example.com/webhooks/korapay',
      customer: { name: 'John Doe', email: 'john@example.com' },
    });
    expect(res).toMatchObject({
      railRef: 'escrow-1',
      status: 'pending',
      instructions: { type: 'virtual_account', value: '7590031627' },
    });
  });

  it('uses hosted checkout (redirect) for card pay-ins', async () => {
    const { fn, calls } = fakeFetch({
      status: true,
      data: { reference: 'escrow-2', checkout_url: 'https://checkout.korapay.com/escrow-2/pay' },
    });
    const rail = new KorapayRail(cfg(fn));
    const res = await rail.initiatePayIn({
      reference: 'escrow-2', amount: 250000, currency: 'ZAR', country: 'ZA',
      method: 'card', payer: { name: 'Jane' }, metadata: { email: 'jane@example.com' },
    });
    expect(calls[0]!.url).toBe('https://api.korapay.com/merchant/api/v1/charges/initialize');
    expect(res).toMatchObject({
      status: 'pending',
      instructions: { type: 'redirect', value: 'https://checkout.korapay.com/escrow-2/pay' },
    });
  });

  it('throws on a non-OK Korapay response', async () => {
    const { fn } = fakeFetch({ status: false, message: 'Invalid request' }, false, 400);
    const rail = new KorapayRail(cfg(fn));
    await expect(
      rail.initiatePayIn({ reference: 'x', amount: 1000, currency: 'NGN', country: 'NG', method: 'bank_transfer', payer: { name: 'X' }, metadata: { email: 'x@example.com' } }),
    ).rejects.toThrow(/Korapay error 400/);
  });
});

describe('initiatePayout (disburse from balance)', () => {
  it('builds the disburse request and maps the response', async () => {
    const { fn, calls } = fakeFetch({
      status: true,
      message: 'transfer initiated successfully',
      data: { reference: 'payout-1', status: 'processing', amount: '985.00', currency: 'NGN' },
    });
    const rail = new KorapayRail(cfg(fn));
    const req: PayoutRequest = {
      reference: 'payout-1', amount: 98500, currency: 'NGN', country: 'NG',
      method: 'bank_transfer',
      recipient: { name: 'Seller', accountRef: '0123456789', bankCode: '044' },
      metadata: { email: 'seller@example.com', narration: 'Escrow release' },
    };
    const res = await rail.initiatePayout(req);
    expect(calls[0]!.url).toBe('https://api.korapay.com/merchant/api/v1/transactions/disburse');
    expect(calls[0]!.body).toMatchObject({
      reference: 'payout-1',
      destination: {
        type: 'bank_account',
        amount: 985,
        currency: 'NGN',
        narration: 'Escrow release',
        bank_account: { bank: '044', account: '0123456789' },
        customer: { name: 'Seller', email: 'seller@example.com' },
      },
    });
    expect(res).toEqual({ railRef: 'payout-1', status: 'pending' });
  });
});

describe('getStatus (charge verify)', () => {
  it('maps a success charge to succeeded', async () => {
    const { fn, calls } = fakeFetch({ status: true, data: { reference: 'escrow-1', status: 'success' } });
    const rail = new KorapayRail(cfg(fn));
    const res = await rail.getStatus('escrow-1');
    expect(calls[0]!.url).toBe('https://api.korapay.com/merchant/api/v1/charges/escrow-1');
    expect(res).toEqual({ railRef: 'escrow-1', status: 'succeeded' });
  });
  it('maps a failed charge to failed', async () => {
    const { fn } = fakeFetch({ status: true, data: { reference: 'escrow-1', status: 'failed' } });
    const rail = new KorapayRail(cfg(fn));
    expect(await rail.getStatus('escrow-1')).toEqual({ railRef: 'escrow-1', status: 'failed' });
  });
});

describe('getBalances', () => {
  it('returns available balance in minor units per currency', async () => {
    const { fn, calls } = fakeFetch({
      status: true,
      data: { NGN: { pending_balance: 100.5, available_balance: 4003.9 }, USD: { pending_balance: 0, available_balance: 10.25 } },
    });
    const rail = new KorapayRail(cfg(fn));
    const bal = await rail.getBalances();
    expect(calls[0]!.url).toBe('https://api.korapay.com/merchant/api/v1/balances');
    expect(bal.NGN!.available).toBe(400390); // 4003.90 → minor units
    expect(bal.USD!.available).toBe(1025);
  });
});

describe('parseWebhook → NormalizedEvent', () => {
  const rail = new KorapayRail(cfg(fakeFetch({}).fn));
  it('charge.success → payin.succeeded', () => {
    expect(rail.parseWebhook({ event: 'charge.success', data: { reference: 'escrow-1' } }, {}))
      .toMatchObject({ type: 'payin.succeeded', railRef: 'escrow-1', reference: 'escrow-1' });
  });
  it('charge.failed → payin.failed', () => {
    expect(rail.parseWebhook({ event: 'charge.failed', data: { reference: 'escrow-1' } }, {}))
      .toMatchObject({ type: 'payin.failed', railRef: 'escrow-1' });
  });
  it('transfer.success → payout.succeeded', () => {
    expect(rail.parseWebhook({ event: 'transfer.success', data: { reference: 'payout-1' } }, {}))
      .toMatchObject({ type: 'payout.succeeded', railRef: 'payout-1' });
  });
  it('transfer.failed → payout.failed', () => {
    expect(rail.parseWebhook({ event: 'transfer.failed', data: { reference: 'payout-1' } }, {}))
      .toMatchObject({ type: 'payout.failed', railRef: 'payout-1' });
  });
  it('unknown/irrelevant events → null', () => {
    expect(rail.parseWebhook({ event: 'charge.pending', data: { reference: 'x' } }, {})).toBeNull();
    expect(rail.parseWebhook({ foo: 'bar' }, {})).toBeNull();
    expect(rail.parseWebhook(null, {})).toBeNull();
  });
});

describe('verifyWebhook (HMAC-SHA256 of data field, secret key)', () => {
  const rail = new KorapayRail(cfg(fakeFetch({}).fn));
  const data = { reference: 'escrow-1', amount: 1500, currency: 'NGN', status: 'success' };
  const body = { event: 'charge.success', data };
  const sign = (d: unknown) => createHmac('sha256', SECRET).update(JSON.stringify(d)).digest('hex');

  it('accepts a correctly signed payload', () => {
    expect(rail.verifyWebhook(body, { 'x-korapay-signature': sign(data) })).toBe(true);
  });
  it('rejects a tampered payload / wrong signature', () => {
    expect(rail.verifyWebhook({ ...body, data: { ...data, amount: 999999 } }, { 'x-korapay-signature': sign(data) })).toBe(false);
    expect(rail.verifyWebhook(body, { 'x-korapay-signature': 'deadbeef' })).toBe(false);
    expect(rail.verifyWebhook(body, {})).toBe(false);
  });
  it('is case-insensitive about the signature header name', () => {
    expect(rail.verifyWebhook(body, { 'X-Korapay-Signature': sign(data) })).toBe(true);
  });
});
