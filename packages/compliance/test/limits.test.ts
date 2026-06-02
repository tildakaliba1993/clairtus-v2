import { describe, it, expect } from 'vitest';
import {
  BCC_RULES,
  bccRulesFromEnv,
  toUsd,
  fromUsd,
  minAmount,
  checkAmountBounds,
  checkVolumeLimits,
  isStructuring,
} from '../src';

const RATE = 2830; // CDF per USD

describe('FX conversion (matches live B2C helpers)', () => {
  it('toUsd: CDF ÷ rate, USD passthrough', () => {
    expect(toUsd(2830, 'CDF', RATE)).toBe(1);
    expect(toUsd(500, 'USD', RATE)).toBe(500);
  });
  it('fromUsd: USD × rate floored for CDF, 2dp for USD', () => {
    expect(fromUsd(500, 'CDF', RATE)).toBe(1415000);
    expect(fromUsd(1.5, 'USD', RATE)).toBe(1.5);
  });
  it('minAmount: 1 USD or its CDF equivalent', () => {
    expect(minAmount('USD', RATE)).toBe(1);
    expect(minAmount('CDF', RATE)).toBe(2830);
  });
});

describe('per-transaction bounds', () => {
  it('accepts within bounds', () => {
    expect(checkAmountBounds(100, 'USD', RATE)).toEqual({ ok: true });
    expect(checkAmountBounds(1415000, 'CDF', RATE)).toEqual({ ok: true });
  });
  it('rejects below minimum', () => {
    expect(checkAmountBounds(0.5, 'USD', RATE)).toEqual({ ok: false, code: 'BELOW_MIN', min: 1 });
    expect(checkAmountBounds(2000, 'CDF', RATE)).toEqual({ ok: false, code: 'BELOW_MIN', min: 2830 });
  });
  it('rejects above the daily/per-tx cap', () => {
    expect(checkAmountBounds(501, 'USD', RATE)).toEqual({ ok: false, code: 'ABOVE_MAX', max: 500 });
    expect(checkAmountBounds(1415001, 'CDF', RATE)).toEqual({ ok: false, code: 'ABOVE_MAX', max: 1415000 });
  });
});

describe('cumulative daily / monthly ceilings', () => {
  it('allows when within remaining headroom', () => {
    expect(checkVolumeLimits({ depositAmount: 100, currency: 'USD', rate: RATE, dailyUsedUsd: 300, monthlyUsedUsd: 1000 }))
      .toEqual({ ok: true });
  });
  it('blocks when the day would be exceeded, reporting remaining', () => {
    const r = checkVolumeLimits({ depositAmount: 300, currency: 'USD', rate: RATE, dailyUsedUsd: 300, monthlyUsedUsd: 600 });
    expect(r).toEqual({ ok: false, code: 'DAILY_EXCEEDED', dailyRemaining: 200, monthlyRemaining: 1900 });
  });
  it('blocks when the month would be exceeded', () => {
    const r = checkVolumeLimits({ depositAmount: 200, currency: 'USD', rate: RATE, dailyUsedUsd: 0, monthlyUsedUsd: 2400 });
    expect(r).toEqual({ ok: false, code: 'MONTHLY_EXCEEDED', monthlyRemaining: 100 });
  });
  it('CDF remaining is reported in CDF', () => {
    const r = checkVolumeLimits({ depositAmount: 1415000, currency: 'CDF', rate: RATE, dailyUsedUsd: 300, monthlyUsedUsd: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok && r.code === 'DAILY_EXCEEDED') expect(r.dailyRemaining).toBe(fromUsd(200, 'CDF', RATE));
  });
});

describe('per-tenant / authorization overrides', () => {
  it('defaults to BCC limits', () => {
    expect(bccRulesFromEnv({})).toEqual(BCC_RULES);
  });
  it('raises caps when authorized via env', () => {
    const rules = bccRulesFromEnv({ BCC_MAX_USD: '3000', BCC_MONTHLY_MAX_USD: '10000' });
    expect(rules).toEqual({ minUsd: 1, dailyMaxUsd: 3000, monthlyMaxUsd: 10000 });
    expect(checkAmountBounds(1000, 'USD', RATE, rules)).toEqual({ ok: true });
  });
});

describe('AML structuring signal (ping-pong)', () => {
  it('flags ≥2 repeats with the same counterparty', () => {
    expect(isStructuring({ repeatCountWithCounterparty: 2 })).toBe(true);
    expect(isStructuring({ repeatCountWithCounterparty: 1 })).toBe(false);
    expect(isStructuring({ repeatCountWithCounterparty: 5, threshold: 6 })).toBe(false);
  });
});
