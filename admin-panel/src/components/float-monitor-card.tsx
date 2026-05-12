"use client";

import { useState } from "react";

interface BalanceRow {
  wallet: string;
  currency: string;
  available: number;
}

interface FloatData {
  payout_balance_usd: number;
  level: "ok" | "warning" | "critical";
  blocked_new_transactions: boolean;
  balances: BalanceRow[];
  payout_volume_24h_usd: number;
  projected_payout_24h_usd: number;
  projected_hours_of_cover: number | null;
  sampled_at: string;
}

interface FloatMonitorCardProps {
  initialData: FloatData;
}

function levelClasses(level: FloatData["level"]): string {
  if (level === "critical") {
    return "bg-red-100 text-red-700";
  }
  if (level === "warning") {
    return "bg-amber-100 text-amber-700";
  }
  return "bg-emerald-100 text-emerald-700";
}

export function FloatMonitorCard({ initialData }: FloatMonitorCardProps) {
  const [data, setData] = useState<FloatData>(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setIsRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/monitoring/float?force_refresh=1", {
        method: "GET",
      });
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } & Partial<FloatData> | null;
      if (!response.ok || body?.ok === false) {
        throw new Error(body?.error ?? "Failed to refresh float balances.");
      }

      setData({
        payout_balance_usd: body?.payout_balance_usd ?? data.payout_balance_usd,
        level: (body?.level as FloatData["level"]) ?? data.level,
        blocked_new_transactions: body?.blocked_new_transactions ?? data.blocked_new_transactions,
        balances: (body?.balances as BalanceRow[]) ?? data.balances,
        payout_volume_24h_usd: body?.payout_volume_24h_usd ?? data.payout_volume_24h_usd,
        projected_payout_24h_usd: body?.projected_payout_24h_usd ?? data.projected_payout_24h_usd,
        projected_hours_of_cover: body?.projected_hours_of_cover ?? data.projected_hours_of_cover,
        sampled_at: body?.sampled_at ?? data.sampled_at,
      });
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Refresh failed.");
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">Float Balance Monitoring</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Current PawaPay balances, risk level, and payout projections.
          </p>
        </div>
        <button
          type="button"
          disabled={isRefreshing}
          onClick={refresh}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRefreshing ? "Refreshing..." : "Refresh Balance"}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <article className="rounded-md border border-zinc-200 p-3">
          <p className="text-xs uppercase tracking-wide text-zinc-500">USD Payout Balance</p>
          <p className="text-xl font-semibold text-zinc-900">
            ${data.payout_balance_usd.toFixed(2)}
          </p>
        </article>
        <article className="rounded-md border border-zinc-200 p-3">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Alert Level</p>
          <p className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${levelClasses(data.level)}`}>
            {data.level}
          </p>
        </article>
        <article className="rounded-md border border-zinc-200 p-3">
          <p className="text-xs uppercase tracking-wide text-zinc-500">24h Payout Volume</p>
          <p className="text-xl font-semibold text-zinc-900">
            ${data.payout_volume_24h_usd.toFixed(2)}
          </p>
        </article>
        <article className="rounded-md border border-zinc-200 p-3">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Projected Cover (hours)</p>
          <p className="text-xl font-semibold text-zinc-900">
            {data.projected_hours_of_cover === null
              ? "N/A"
              : data.projected_hours_of_cover.toFixed(1)}
          </p>
        </article>
      </div>

      <p className="mt-3 text-sm text-zinc-600">
        New transaction blocking: {data.blocked_new_transactions ? "enabled (critical float)" : "disabled"}.
      </p>
      <p className="text-xs text-zinc-500">
        Last sampled: {new Date(data.sampled_at).toLocaleString()}
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-left text-zinc-600">
            <tr>
              <th className="px-3 py-2 font-medium">Wallet</th>
              <th className="px-3 py-2 font-medium">Currency</th>
              <th className="px-3 py-2 font-medium">Available</th>
            </tr>
          </thead>
          <tbody>
            {data.balances.map((balance, index) => (
              <tr key={`${balance.wallet}-${index}`} className="border-t border-zinc-100">
                <td className="px-3 py-2 text-zinc-700">{balance.wallet}</td>
                <td className="px-3 py-2 text-zinc-700">{balance.currency}</td>
                <td className="px-3 py-2 text-zinc-700">{balance.available.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
