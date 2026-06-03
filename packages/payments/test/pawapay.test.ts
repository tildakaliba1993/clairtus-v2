import { describe, it, expect } from 'vitest';
import {
  PawaPayRail,
  correspondentForPhone,
  formatMajorAmount,
  type PayInRequest,
  type PayoutRequest,
} from '../src';

/** A fake fetch that records calls and returns canned JSON (contract test harness). */
function fakeFetch(json: unknown, ok = true, status = 200) {
  const calls: { url: string; body: any; headers: any }[] = [];
  const fn = (async (url: string, init?: { body?: string; headers?: any }) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined, headers: init?.headers });
    return {
      ok, status,
      json: async () => json,
      text: async () => JSON.stringify(json),
    } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const cfg = (fetchImpl: typeof fetch) => ({
  baseUrl: 'https://api.sandbox.pawapay.io',
  token: 'test-token',
  returnUrl: 'https://example.com/webhook',
  fetchImpl,
});

describe('correspondent + amount mapping (ported from B2C)', () => {
  it('maps phone prefixes to correspondents', () => {
    expect(correspondentForPhone('243990000000')).toBe('AIRTEL_COD');
    expect(correspondentForPhone('243840000000')).toBe('ORANGE_COD');
    expect(correspondentForPhone('243810000000')).toBe('VODACOM_MPESA_COD');
  });
  it('formats CDF on Vodacom as whole numbers, others to 2dp', () => {
    expect(formatMajorAmount('VODACOM_MPESA_COD', 'CDF', 1415000)).toBe('1415000');
    expect(formatMajorAmount('VODACOM_MPESA_COD', 'USD', 100)).toBe('100.00');
    expect(formatMajorAmount('ORANGE_COD', 'CDF', 1415000.4)).toBe('1415000.40');
  });
});

describe('initiatePayIn', () => {
  it('builds the deposit request from minor units and maps the response', async () => {
    const { fn, calls } = fakeFetch({ depositId: 'dep-1', status: 'ACCEPTED' });
    const rail = new PawaPayRail(cfg(fn));
    const req: PayInRequest = {
      reference: 'dep-1', amount: 10000, currency: 'USD', country: 'CD',
      method: 'mobile_money', payer: { phone: '243810000000' },
    };
    const res = await rail.initiatePayIn(req);
    expect(calls[0]!.url).toBe('https://api.sandbox.pawapay.io/v1/deposits');
    expect(calls[0]!.body).toMatchObject({
      depositId: 'dep-1', amount: '100.00', currency: 'USD', country: 'COD',
      correspondent: 'VODACOM_MPESA_COD', payer: { type: 'MSISDN', address: { value: '243810000000' } },
      returnUrl: 'https://example.com/webhook',
    });
    expect(res).toMatchObject({ railRef: 'dep-1', status: 'pending', instructions: { type: 'prompt' } });
  });

  it('converts CDF minor units to a whole-number major amount', async () => {
    const { fn, calls } = fakeFetch({ status: 'ACCEPTED' });
    const rail = new PawaPayRail(cfg(fn));
    await rail.initiatePayIn({
      reference: 'dep-2', amount: 141500000, currency: 'CDF', country: 'CD',
      method: 'mobile_money', payer: { phone: '243810000000' },
    });
    expect(calls[0]!.body.amount).toBe('1415000'); // 141,500,000 minor → 1,415,000 CDF
  });

  it('throws on a non-OK PawaPay response', async () => {
    const { fn } = fakeFetch({ errorMessage: 'rejected' }, false, 400);
    const rail = new PawaPayRail(cfg(fn));
    await expect(
      rail.initiatePayIn({ reference: 'x', amount: 10000, currency: 'USD', country: 'CD', method: 'mobile_money', payer: { phone: '243810000000' } }),
    ).rejects.toThrow(/PawaPay error 400/);
  });
});

describe('initiatePayout', () => {
  it('builds the payout request and maps the response', async () => {
    const { fn, calls } = fakeFetch({ payoutId: 'pay-1', status: 'ACCEPTED' });
    const rail = new PawaPayRail(cfg(fn));
    const req: PayoutRequest = {
      reference: 'pay-1', amount: 98500, currency: 'USD', country: 'CD',
      method: 'mobile_money', recipient: { phone: '243990000000' },
    };
    const res = await rail.initiatePayout(req);
    expect(calls[0]!.url).toBe('https://api.sandbox.pawapay.io/v1/payouts');
    expect(calls[0]!.body).toMatchObject({ payoutId: 'pay-1', amount: '985.00', correspondent: 'AIRTEL_COD' });
    expect(res).toEqual({ railRef: 'pay-1', status: 'pending' });
  });
});

describe('getStatus', () => {
  it('maps a COMPLETED deposit record (array form) to succeeded', async () => {
    const { fn } = fakeFetch([{ depositId: 'dep-1', status: 'COMPLETED' }]);
    const rail = new PawaPayRail(cfg(fn));
    expect(await rail.getStatus('dep-1')).toEqual({ railRef: 'dep-1', status: 'succeeded' });
  });
});

describe('parseWebhook → NormalizedEvent', () => {
  const rail = new PawaPayRail(cfg(fakeFetch({}).fn));
  it('deposit COMPLETED → payin.succeeded', () => {
    expect(rail.parseWebhook({ depositId: 'dep-1', status: 'COMPLETED' })).toMatchObject({ type: 'payin.succeeded', railRef: 'dep-1' });
  });
  it('payout FAILED → payout.failed', () => {
    expect(rail.parseWebhook({ payoutId: 'pay-1', status: 'FAILED' })).toMatchObject({ type: 'payout.failed', railRef: 'pay-1' });
  });
  it('pending/unknown → null', () => {
    expect(rail.parseWebhook({ depositId: 'dep-1', status: 'ACCEPTED' })).toBeNull();
    expect(rail.parseWebhook({ foo: 'bar' })).toBeNull();
    expect(rail.parseWebhook(null)).toBeNull();
  });
});
