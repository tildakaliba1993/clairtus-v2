import { describe, it, expect } from 'vitest';
import {
  money, zero, add, subtract, sum, applyBps,
  isNegative, isZero, gt, gte, eq, MoneyError,
} from '../src/money';

describe('money()', () => {
  it('rejects non-integer amounts (no floats for money)', () => {
    expect(() => money(1.5, 'USD')).toThrow(MoneyError);
  });
  it('requires a currency', () => {
    expect(() => money(100, '')).toThrow(MoneyError);
  });
  it('constructs integer minor units', () => {
    expect(money(100, 'USD')).toEqual({ amount: 100, currency: 'USD' });
  });
});

describe('arithmetic', () => {
  it('adds and subtracts within a currency', () => {
    expect(add(money(100, 'USD'), money(50, 'USD'))).toEqual(money(150, 'USD'));
    expect(subtract(money(100, 'USD'), money(30, 'USD'))).toEqual(money(70, 'USD'));
  });
  it('throws on currency mismatch', () => {
    expect(() => add(money(100, 'USD'), money(50, 'CDF'))).toThrow(MoneyError);
    expect(() => subtract(money(100, 'USD'), money(50, 'ZAR'))).toThrow(MoneyError);
  });
  it('sums a list', () => {
    expect(sum([money(10, 'CDF'), money(20, 'CDF'), money(30, 'CDF')], 'CDF')).toEqual(money(60, 'CDF'));
    expect(sum([], 'USD')).toEqual(zero('USD'));
  });
});

describe('predicates', () => {
  it('isNegative / isZero', () => {
    expect(isNegative(money(-1, 'USD'))).toBe(true);
    expect(isZero(zero('USD'))).toBe(true);
  });
  it('gt / gte / eq', () => {
    expect(gt(money(100, 'USD'), money(50, 'USD'))).toBe(true);
    expect(gte(money(50, 'USD'), money(50, 'USD'))).toBe(true);
    expect(eq(money(50, 'USD'), money(50, 'USD'))).toBe(true);
    expect(eq(money(50, 'USD'), money(50, 'CDF'))).toBe(false);
  });
});

describe('applyBps (fee math, rounded to nearest minor unit)', () => {
  it('1.5% of 100.00 (10000 minor) = 1.50 (150)', () => {
    expect(applyBps(money(10000, 'USD'), 150)).toEqual(money(150, 'USD'));
  });
  it('rounds to nearest minor unit', () => {
    // 1.5% of 333 = 4.995 -> 5
    expect(applyBps(money(333, 'USD'), 150)).toEqual(money(5, 'USD'));
  });
  it('0 bps (promo) yields zero fee', () => {
    expect(applyBps(money(10000, 'USD'), 0)).toEqual(zero('USD'));
  });
  it('rejects negative or non-integer bps', () => {
    expect(() => applyBps(money(100, 'USD'), -1)).toThrow(MoneyError);
    expect(() => applyBps(money(100, 'USD'), 1.5)).toThrow(MoneyError);
  });
});
