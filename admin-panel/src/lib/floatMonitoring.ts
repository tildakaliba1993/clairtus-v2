import type { SupabaseClient } from "@supabase/supabase-js";

export type AlertLevel = "ok" | "warning" | "critical";

interface PawaPayBalanceRecord {
  wallet?: string;
  walletType?: string;
  type?: string;
  currency?: string;
  balance?: string | number;
  availableBalance?: string | number;
  amount?: string | number;
}

interface PawaPayBalancesResponse {
  balances?: PawaPayBalanceRecord[];
}

export interface FloatSnapshot {
  payout_balance_usd: number;
  level: AlertLevel;
  blocked_new_transactions: boolean;
  balances: Array<{
    wallet: string;
    currency: string;
    available: number;
  }>;
  payout_volume_24h_usd: number;
  projected_payout_24h_usd: number;
  projected_hours_of_cover: number | null;
  sampled_at: string;
}

function resolveFallbackBalanceUsd(): number {
  const parsed = Number.parseFloat(process.env.PAWAPAY_FLOAT_FALLBACK_USD ?? "1000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractWalletName(record: PawaPayBalanceRecord): string {
  return (record.wallet ?? record.walletType ?? record.type ?? "unknown").toString();
}

function normalizeBalances(raw: unknown): Array<{
  wallet: string;
  currency: string;
  available: number;
}> {
  const records: PawaPayBalanceRecord[] = [];
  if (Array.isArray(raw)) {
    records.push(...(raw as PawaPayBalanceRecord[]));
  } else if (raw && typeof raw === "object") {
    const obj = raw as PawaPayBalancesResponse;
    if (Array.isArray(obj.balances)) {
      records.push(...obj.balances);
    } else {
      records.push(raw as PawaPayBalanceRecord);
    }
  }

  return records
    .map((record) => {
      const available = parseNumeric(record.availableBalance) ??
        parseNumeric(record.balance) ??
        parseNumeric(record.amount);
      if (available === null) {
        return null;
      }
      return {
        wallet: extractWalletName(record),
        currency: (record.currency ?? "USD").toUpperCase(),
        available,
      };
    })
    .filter((value): value is { wallet: string; currency: string; available: number } =>
      value !== null
    );
}

function selectUsdPayoutBalance(
  balances: Array<{ wallet: string; currency: string; available: number }>,
): number | null {
  const payoutUsd = balances.find((balance) =>
    balance.currency === "USD" && balance.wallet.toLowerCase().includes("payout")
  );
  if (payoutUsd) {
    return payoutUsd.available;
  }
  const firstUsd = balances.find((balance) => balance.currency === "USD");
  return firstUsd ? firstUsd.available : null;
}

export function computeAlertLevel(balance: number): AlertLevel {
  if (balance < 500) {
    return "critical";
  }
  if (balance < 1000) {
    return "warning";
  }
  return "ok";
}

async function fetchPawaPayBalances(): Promise<Array<{
  wallet: string;
  currency: string;
  available: number;
}>> {
  const baseUrl = process.env.PAWAPAY_API_BASE_URL ?? process.env.PAWAPAY_BASE_URL;
  const apiKey = process.env.PAWAPAY_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error("Missing PAWAPAY_API_BASE_URL/PAWAPAY_BASE_URL or PAWAPAY_API_KEY.");
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/balances`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body && typeof body === "object" ? JSON.stringify(body) : "";
    throw new Error(`PawaPay balances request failed (${response.status}) ${detail}`);
  }

  return normalizeBalances(body);
}

export async function getFloatSnapshot(supabase: SupabaseClient): Promise<FloatSnapshot> {
  let balances: Array<{ wallet: string; currency: string; available: number }> = [];
  let payoutBalanceUsd: number | null = null;
  try {
    balances = await fetchPawaPayBalances();
    payoutBalanceUsd = selectUsdPayoutBalance(balances);
  } catch {
    payoutBalanceUsd = resolveFallbackBalanceUsd();
    balances = [{
      wallet: "fallback",
      currency: "USD",
      available: payoutBalanceUsd,
    }];
  }
  if (payoutBalanceUsd === null) {
    payoutBalanceUsd = resolveFallbackBalanceUsd();
    balances = [{
      wallet: "fallback",
      currency: "USD",
      available: payoutBalanceUsd,
    }];
  }

  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: completedRows, error: payoutVolumeError } = await supabase
    .from("transactions")
    .select("base_amount, clairtus_fee")
    .eq("status", "COMPLETED")
    .gte("updated_at", sinceIso);

  if (payoutVolumeError) {
    throw new Error(`Failed to load 24h payout volume: ${payoutVolumeError.message}`);
  }

  const payoutVolume24h = (completedRows ?? []).reduce((sum, row) => {
    const typedRow = row as { base_amount: number; clairtus_fee: number };
    return sum + Math.max(0, Number(typedRow.base_amount) - Number(typedRow.clairtus_fee));
  }, 0);

  const hourlyBurn = payoutVolume24h / 24;
  const projectedHoursRemaining = hourlyBurn > 0 ? payoutBalanceUsd / hourlyBurn : null;

  return {
    payout_balance_usd: payoutBalanceUsd,
    level: computeAlertLevel(payoutBalanceUsd),
    blocked_new_transactions: payoutBalanceUsd < 500,
    balances,
    payout_volume_24h_usd: payoutVolume24h,
    projected_payout_24h_usd: payoutVolume24h,
    projected_hours_of_cover: projectedHoursRemaining,
    sampled_at: new Date().toISOString(),
  };
}
