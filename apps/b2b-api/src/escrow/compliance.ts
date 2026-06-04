import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  BCC_RULES,
  checkAmountBounds,
  checkVolumeLimits,
  isStructuring,
  type MarketRules,
} from '@clairtus/compliance';
import { SQL, KYC_RELEASE_THRESHOLD, type SqlExecutor } from '../db/sql';

/** DI token for the per-market compliance configuration (rules, FX, KYC tiers). */
export const COMPLIANCE_CONFIG = 'COMPLIANCE_CONFIG';

export interface ComplianceConfig {
  /** Per-market (ISO-2 country) rule sets, in USD. */
  rulesByCountry: Record<string, MarketRules>;
  /** Fallback rules when a tenant's country isn't mapped. */
  defaultRules: MarketRules;
  /** Local major units per 1 USD, per currency (USD = 1). */
  fxRatesPerUsd: Record<string, number>;
  /** Optional per-market KYC step-up tier, in USD; release above it needs a VERIFIED seller. */
  kycTierUsdByCountry: Record<string, number>;
  /** Structuring signal: repeated escrows with the same counterparty in 24h ≥ this → flag. */
  structuringThreshold: number;
  /** Minor-unit exponent (cents). MVP currencies (ZAR/USD/NGN) are 2dp. */
  minorUnitExponent: number;
}

const SA_RULES = (env: NodeJS.ProcessEnv): MarketRules => ({
  // South Africa has no regulatory per-tx minimum like the DRC's BCC; caps are FICA-aligned basics.
  minUsd: Number(env.FICA_MIN_USD ?? 0),
  dailyMaxUsd: Number(env.FICA_DAILY_MAX_USD ?? 1500),
  monthlyMaxUsd: Number(env.FICA_MONTHLY_MAX_USD ?? 15000),
});

/** Build the compliance config from env, with sensible launch defaults (SA beachhead + DRC BCC). */
export function complianceConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ComplianceConfig {
  const sa = SA_RULES(env);
  const kycTierUsdByCountry: Record<string, number> = {};
  if (env.KYC_THRESHOLD_ZA_USD) kycTierUsdByCountry.ZA = Number(env.KYC_THRESHOLD_ZA_USD);
  if (env.KYC_THRESHOLD_CD_USD) kycTierUsdByCountry.CD = Number(env.KYC_THRESHOLD_CD_USD);
  return {
    rulesByCountry: { ZA: sa, CD: BCC_RULES, CG: BCC_RULES },
    defaultRules: sa,
    fxRatesPerUsd: {
      USD: 1,
      ZAR: Number(env.FX_ZAR_USD ?? 18.5),
      NGN: Number(env.FX_NGN_USD ?? 1600),
      CDF: Number(env.FX_CDF_USD ?? 2830),
    },
    kycTierUsdByCountry,
    structuringThreshold: Number(env.STRUCTURING_THRESHOLD ?? 3),
    minorUnitExponent: 2,
  };
}

export interface CreateCheckInput {
  tenantId: string;
  country: string;
  currency: string;
  baseAmountMinor: number;
  buyerPartyId?: string | null;
  sellerPartyId: string;
}

/**
 * Wires @clairtus/compliance into the escrow lifecycle. Amounts arrive in integer minor units; we
 * convert them to USD (the engine's regulatory base) in the adapter and call the pure engine in USD,
 * so the same rule set works for every market without touching the shared engine. Every decision is
 * recorded (compliance_decisions) — the seam the M5 audit log builds on.
 */
@Injectable()
export class ComplianceService {
  constructor(
    @Inject(SQL) private readonly sql: SqlExecutor,
    @Inject(COMPLIANCE_CONFIG) private readonly cfg: ComplianceConfig,
    @Inject(KYC_RELEASE_THRESHOLD) private readonly globalKycThresholdMinor: number,
  ) {}

  private rulesFor(country: string): MarketRules {
    return this.cfg.rulesByCountry[country] ?? this.cfg.defaultRules;
  }

  private ratePerUsd(currency: string): number {
    return this.cfg.fxRatesPerUsd[currency] ?? 1;
  }

  /** Integer minor units → USD major units. */
  toUsd(minorAmount: number, currency: string): number {
    const major = minorAmount / 10 ** this.cfg.minorUnitExponent;
    return major / this.ratePerUsd(currency);
  }

  /** Resolve the KYC step-up threshold for a market, in the escrow currency's minor units. */
  releaseKycThresholdMinor(country: string, currency: string): number {
    const tierUsd = this.cfg.kycTierUsdByCountry[country];
    if (tierUsd === undefined) return this.globalKycThresholdMinor;
    return Math.round(tierUsd * this.ratePerUsd(currency) * 10 ** this.cfg.minorUnitExponent);
  }

  /** Gate escrow creation on per-market amount bounds + cumulative volume; flag structuring. */
  async assertCreateAllowed(input: CreateCheckInput): Promise<{ structuring: boolean }> {
    const rules = this.rulesFor(input.country);
    const amountUsd = this.toUsd(input.baseAmountMinor, input.currency);
    const { dailyUsedUsd, monthlyUsedUsd } = await this.usedVolumeUsd(input.tenantId);
    const structuring = await this.detectStructuring(input);

    const amount = checkAmountBounds(amountUsd, 'USD', 1, rules);
    if (!amount.ok) {
      const reason = amount.code === 'BELOW_MIN'
        ? `amount below market minimum (${rules.minUsd} USD)`
        : `amount above market per-transaction maximum (${rules.dailyMaxUsd} USD)`;
      await this.record('create', input, amountUsd, dailyUsedUsd, monthlyUsedUsd, structuring, 'deny', reason);
      throw new UnprocessableEntityException(reason);
    }

    const volume = checkVolumeLimits({ depositAmount: amountUsd, currency: 'USD', rate: 1, dailyUsedUsd, monthlyUsedUsd, rules });
    if (!volume.ok) {
      const reason = volume.code === 'DAILY_EXCEEDED'
        ? `daily volume limit exceeded (${rules.dailyMaxUsd} USD)`
        : `monthly volume limit exceeded (${rules.monthlyMaxUsd} USD)`;
      await this.record('create', input, amountUsd, dailyUsedUsd, monthlyUsedUsd, structuring, 'deny', reason);
      throw new UnprocessableEntityException(reason);
    }

    await this.record('create', input, amountUsd, dailyUsedUsd, monthlyUsedUsd, structuring, 'allow', structuring ? 'allowed; structuring flagged' : null);
    return { structuring };
  }

  /** Sum the tenant's prior escrow volume in the rolling 24h / 30d windows, in USD. */
  private async usedVolumeUsd(tenantId: string): Promise<{ dailyUsedUsd: number; monthlyUsedUsd: number }> {
    const { rows } = await this.sql.query<{ base_amount: string | number; currency: string; created_at: string }>(
      `select base_amount, currency, created_at from escrows
       where tenant_id = $1 and created_at >= now() - interval '30 days'`,
      [tenantId],
    );
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let daily = 0;
    let monthly = 0;
    for (const r of rows) {
      const usd = this.toUsd(Number(r.base_amount), r.currency);
      monthly += usd;
      if (new Date(r.created_at).getTime() >= dayAgo) daily += usd;
    }
    return { dailyUsedUsd: daily, monthlyUsedUsd: monthly };
  }

  /** Count prior escrows in 24h with the same buyer→seller counterparty → structuring signal. */
  private async detectStructuring(input: CreateCheckInput): Promise<boolean> {
    if (!input.buyerPartyId) return false;
    const { rows } = await this.sql.query<{ n: string | number }>(
      `select count(*)::int as n from escrows
       where tenant_id = $1 and buyer_party_id = $2 and seller_party_id = $3
         and created_at >= now() - interval '24 hours'`,
      [input.tenantId, input.buyerPartyId, input.sellerPartyId],
    );
    return isStructuring({ repeatCountWithCounterparty: Number(rows[0]?.n ?? 0), threshold: this.cfg.structuringThreshold });
  }

  private async record(
    kind: 'create' | 'release',
    input: { tenantId: string; country: string; currency: string },
    amountUsd: number,
    dailyUsedUsd: number,
    monthlyUsedUsd: number,
    structuring: boolean,
    outcome: 'allow' | 'deny',
    reason: string | null,
    escrowId: string | null = null,
  ): Promise<void> {
    await this.sql.query(
      `insert into compliance_decisions
         (tenant_id, escrow_id, kind, market, currency, amount_usd, daily_used_usd, monthly_used_usd, structuring, outcome, reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [input.tenantId, escrowId, kind, input.country, input.currency, amountUsd, dailyUsedUsd, monthlyUsedUsd, structuring, outcome, reason],
    );
  }
}
