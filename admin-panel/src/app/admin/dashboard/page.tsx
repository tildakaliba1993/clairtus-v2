import Link from "next/link";
import { FloatMonitorCard } from "@/components/float-monitor-card";
import { requireAdminUser } from "@/lib/auth-guards";
import { getFloatSnapshot } from "@/lib/floatMonitoring";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const WINDOWS = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
  { label: "30d", hours: 24 * 30 },
] as const;

const FAILURE_STATUSES = new Set(["CANCELLED", "PAYOUT_FAILED", "PIN_FAILED_LOCKED"]);

interface TxMetricRow {
  status: string;
  base_amount: number;
  clairtus_fee: number;
  created_at: string;
  updated_at: string;
}

function sinceIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function hoursBetween(fromIso: string, toIso: string): number {
  return Math.max(0, (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 3600000);
}

export default async function AdminDashboardPage() {
  await requireAdminUser();
  const supabase = await createServerSupabaseClient();

  const windowStartIso = sinceIso(24 * 30);
  const { data: txRows, error: txError } = await supabase
    .from("transactions")
    .select("status, base_amount, clairtus_fee, created_at, updated_at")
    .gte("created_at", windowStartIso);

  if (txError) {
    throw new Error(`Failed to load transaction metrics: ${txError.message}`);
  }

  const typedRows = (txRows ?? []) as TxMetricRow[];
  const sections = WINDOWS.map((window) => {
    const startIso = sinceIso(window.hours);
    const scopedRows = typedRows.filter((row) => row.created_at >= startIso);
    const total = scopedRows.length;
    const countsByStatus = scopedRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});
    const gmv = scopedRows.reduce((sum, row) => sum + Number(row.base_amount), 0);
    const revenue = scopedRows.reduce((sum, row) => sum + Number(row.clairtus_fee), 0);
    const failures = scopedRows.filter((row) => FAILURE_STATUSES.has(row.status)).length;
    const failureRate = total > 0 ? (failures / total) * 100 : 0;
    const completedRows = scopedRows.filter((row) => row.status === "COMPLETED");
    const avgCompletionHours = completedRows.length > 0
      ? completedRows.reduce((sum, row) => sum + hoursBetween(row.created_at, row.updated_at), 0) /
        completedRows.length
      : 0;

    return {
      label: window.label,
      total,
      countsByStatus,
      gmv,
      revenue,
      avgCompletionHours,
      failureRate,
    };
  });

  const floatSnapshot = await getFloatSnapshot(supabase);

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Metrics & Monitoring Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Transaction KPIs, failure trends, and payout float monitoring.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/errors"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Open Error Logs
          </Link>
          <Link
            href="/dashboard"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Back to Home
          </Link>
        </div>
      </header>

      <section className="mb-6 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-left text-zinc-600">
            <tr>
              <th className="px-3 py-2 font-medium">Window</th>
              <th className="px-3 py-2 font-medium">Transactions</th>
              <th className="px-3 py-2 font-medium">GMV (USD)</th>
              <th className="px-3 py-2 font-medium">Revenue (USD)</th>
              <th className="px-3 py-2 font-medium">Avg Completion (hours)</th>
              <th className="px-3 py-2 font-medium">Failure Rate</th>
              <th className="px-3 py-2 font-medium">Counts by Status</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <tr key={section.label} className="border-t border-zinc-100">
                <td className="px-3 py-2 font-medium text-zinc-900">{section.label}</td>
                <td className="px-3 py-2 text-zinc-700">{section.total}</td>
                <td className="px-3 py-2 text-zinc-700">${section.gmv.toFixed(2)}</td>
                <td className="px-3 py-2 text-zinc-700">${section.revenue.toFixed(2)}</td>
                <td className="px-3 py-2 text-zinc-700">{section.avgCompletionHours.toFixed(2)}</td>
                <td className="px-3 py-2 text-zinc-700">{section.failureRate.toFixed(2)}%</td>
                <td className="px-3 py-2 text-zinc-700">
                  {Object.entries(section.countsByStatus).length === 0
                    ? "No data"
                    : Object.entries(section.countsByStatus).map(([status, count]) =>
                      `${status}: ${count}`
                    ).join(" | ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <FloatMonitorCard
        initialData={{
          payout_balance_usd: floatSnapshot.payout_balance_usd,
          level: floatSnapshot.level,
          blocked_new_transactions: floatSnapshot.blocked_new_transactions,
          balances: floatSnapshot.balances,
          payout_volume_24h_usd: floatSnapshot.payout_volume_24h_usd,
          projected_payout_24h_usd: floatSnapshot.projected_payout_24h_usd,
          projected_hours_of_cover: floatSnapshot.projected_hours_of_cover,
          sampled_at: floatSnapshot.sampled_at,
        }}
      />
    </main>
  );
}
