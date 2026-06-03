import { describe, it, expect } from 'vitest';
import { modeFromKey, formatMoney, shortId } from './format';

describe('format helpers', () => {
  it('derives the sandbox/live mode from an API key prefix', () => {
    expect(modeFromKey('ck_test_abc')).toBe('sandbox');
    expect(modeFromKey('ck_live_abc')).toBe('live');
    expect(modeFromKey('nonsense')).toBe('unknown');
  });

  it('formats integer minor units as currency', () => {
    expect(formatMoney(100000, 'ZAR')).toContain('1,000.00');
    expect(formatMoney(98500, 'ZAR')).toContain('985.00');
    expect(formatMoney(100000, 'NOTACURRENCY')).toBe('1000.00 NOTACURRENCY');
  });

  it('shortens long ids', () => {
    expect(shortId('1234567890abcdef')).toBe('12345678…');
    expect(shortId('short')).toBe('short');
  });
});
