import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireAdminUser } from "@/lib/auth-guards";
import { createServerSupabaseClient } from "@/lib/supabase/server";

interface SearchParams {
  type?: string;
  resolved?: string;
  from?: string;
  to?: string;
}

interface ErrorLogRow {
  id: number;
  error_type: string;
  error_message: string;
  error_details: Record<string, unknown> | null;
  occurred_at: string;
  resolved: boolean;
  transaction_id: string | null;
}

export default async function AdminErrorsPage(
  { searchParams }: { searchParams: Promise<SearchParams> },
) {
  await requireAdminUser();
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();

  const typeFilter = params.type?.trim() ?? "";
  const resolvedFilter = params.resolved?.trim() ?? "";
  const fromDate = params.from?.trim() ?? "";
  const toDate = params.to?.trim() ?? "";

  let query = supabase
    .from("error_logs")
    .select("id, error_type, error_message, error_details, occurred_at, resolved, transaction_id")
    .order("occurred_at", { ascending: false })
    .limit(500);

  if (typeFilter) {
    query = query.eq("error_type", typeFilter);
  }
  if (resolvedFilter === "true" || resolvedFilter === "false") {
    query = query.eq("resolved", resolvedFilter === "true");
  }
  if (fromDate) {
    query = query.gte("occurred_at", `${fromDate}T00:00:00.000Z`);
  }
  if (toDate) {
    query = query.lte("occurred_at", `${toDate}T23:59:59.999Z`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load error logs: ${error.message}`);
  }

  const rows = (data ?? []) as ErrorLogRow[];
  const grouped = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.error_type] = (acc[row.error_type] ?? 0) + 1;
    return acc;
  }, {});
  const topGroups = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const knownTypes = Array.from(new Set(rows.map((row) => row.error_type))).sort();

  const exportParams = new URLSearchParams();
  if (typeFilter) exportParams.set("type", typeFilter);
  if (resolvedFilter) exportParams.set("resolved", resolvedFilter);
  if (fromDate) exportParams.set("from", fromDate);
  if (toDate) exportParams.set("to", toDate);

  async function markResolved(formData: FormData) {
    "use server";
    await requireAdminUser();
    const idRaw = String(formData.get("error_id") ?? "");
    const id = Number.parseInt(idRaw, 10);
    if (!Number.isFinite(id)) {
      throw new Error("Invalid error id.");
    }

    const serverSupabase = await createServerSupabaseClient();
    const { error: updateError } = await serverSupabase
      .from("error_logs")
      .update({ resolved: true })
      .eq("id", id);
    if (updateError) {
      throw new Error(`Failed to mark resolved: ${updateError.message}`);
    }

    revalidatePath("/admin/errors");
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Error Log Viewer</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Filter, group, resolve, and export operational errors.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/api/admin/errors/export?${exportParams.toString()}`}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Export CSV
          </Link>
          <Link
            href="/admin/dashboard"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Back to Dashboard
          </Link>
        </div>
      </header>

      <form className="mb-6 grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 md:grid-cols-5">
        <select
          name="type"
          defaultValue={typeFilter}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-700"
        >
          <option value="">All error types</option>
          {knownTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <select
          name="resolved"
          defaultValue={resolvedFilter}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-700"
        >
          <option value="">All states</option>
          <option value="false">Unresolved</option>
          <option value="true">Resolved</option>
        </select>
        <input
          type="date"
          name="from"
          defaultValue={fromDate}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-700"
        />
        <input
          type="date"
          name="to"
          defaultValue={toDate}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-700"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Apply
          </button>
          <Link
            href="/admin/errors"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Reset
          </Link>
        </div>
      </form>

      <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-zinc-900">Grouped by Type</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {topGroups.map(([type, count]) => (
            <div key={type} className="rounded-md border border-zinc-200 px-3 py-2 text-sm">
              <span className="font-medium text-zinc-900">{type}</span>
              <span className="ml-2 text-zinc-600">{count}</span>
            </div>
          ))}
          {topGroups.length === 0 ? <p className="text-sm text-zinc-500">No errors to group.</p> : null}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-zinc-900">Error Records</h2>
        <div className="mt-3 space-y-3">
          {rows.map((row) => (
            <article key={row.id} className="rounded-md border border-zinc-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-zinc-900">{row.error_type}</p>
                  <p className="text-xs text-zinc-500">
                    {new Date(row.occurred_at).toLocaleString()} | tx: {row.transaction_id ?? "-"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      row.resolved ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                    }`}
                  >
                    {row.resolved ? "Resolved" : "Unresolved"}
                  </span>
                  {!row.resolved ? (
                    <form action={markResolved}>
                      <input type="hidden" name="error_id" value={row.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        Mark resolved
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
              <p className="mt-2 text-sm text-zinc-700">{row.error_message}</p>
              {row.error_details ? (
                <pre className="mt-2 overflow-x-auto rounded bg-zinc-100 p-2 text-xs text-zinc-700">
                  {JSON.stringify(row.error_details, null, 2)}
                </pre>
              ) : null}
            </article>
          ))}
          {rows.length === 0 ? <p className="text-sm text-zinc-500">No error records found.</p> : null}
        </div>
      </section>
    </main>
  );
}
