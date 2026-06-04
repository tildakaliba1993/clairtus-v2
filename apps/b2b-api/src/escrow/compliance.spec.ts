import { describe, it, expect } from 'vitest';
import type { SqlExecutor } from '../db/sql';
import { ComplianceService, type ComplianceConfig } from './compliance';
import { BCC_RULES } from '@clairtus/compliance';

const fakeSql: SqlExecutor = {
  async query<T = Record<string, unknown>>(): Promise<{ rows: T[] }> {
    return { rows: [] as T[] };
  },
  async transaction<T>(): Promise<T> {
    throw new Error('not used');
  },
};

const cfg: ComplianceConfig = {
  rulesByCountry: { ZA: { minUsd: 0, dailyMaxUsd: 1500, monthlyMaxUsd: 15000 }, CD: BCC_RULES },
  defaultRules: { minUsd: 0, dailyMaxUsd: 1500, monthlyMaxUsd: 15000 },
  fxRatesPerUsd: { USD: 1, ZAR: 20 },
  kycTierUsdByCountry: { ZA: 100 },
  structuringThreshold: 2,
  minorUnitExponent: 2,
};

const svc = (config = cfg, globalKyc = 999) => new ComplianceService(fakeSql, config, globalKyc);

describe('ComplianceService (pure resolution)', () => {
  it('toUsd converts integer minor units to USD major units at the FX rate', () => {
    expect(svc().toUsd(200000, 'ZAR')).toBe(100); // R2000.00 / 20 = $100
    expect(svc().toUsd(5000, 'USD')).toBe(50); // $50.00
  });

  it('releaseKycThresholdMinor uses the per-market tier (USD → minor) when configured', () => {
    // ZA tier 100 USD × rate 20 × 100 (cents) = 200000 minor (R2000.00)
    expect(svc().releaseKycThresholdMinor('ZA', 'ZAR')).toBe(200000);
  });

  it('releaseKycThresholdMinor falls back to the global minor threshold when no tier', () => {
    expect(svc().releaseKycThresholdMinor('CD', 'ZAR')).toBe(999);
  });
});
