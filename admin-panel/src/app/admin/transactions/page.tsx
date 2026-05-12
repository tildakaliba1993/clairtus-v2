import Link from "next/link";
import { requireAdminUser } from "@/lib/auth-guards";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;
const STATUSES = [
  "INITIATED",
  "PENDING_FUNDING",
  "SECURED",
  "COMPLETED",
  "CANCELLED",
  "PIN_FAILED_LOCKED",
  "PAYOUT_FAILED",
  "PAYOUT_DELAYED",
  "HUMAN_SUPPORT",
] as const;

type TransactionStatus = (typeof STATUSES)[number];

interface TransactionListRow {
  id: string;
  status: TransactionStatus;
  buyer_phone: string;
  seller_phone: string;
  base_amount: number;
  created_at: string;
  expires_at: string;
  requires_human: boolean;
}

interface SearchParams {
  status?: string;
  phone?: string;
  q?: string;
  date_from?: string;
  date_to?: string;
  page?: string;
}

function normalizePage(rawPage: string | undefined): number {
  const parsed = Number.parseInt(rawPage ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function safePhoneLike(value: string): string {
  return value.replaceAll("%", "").replaceAll(",", "").trim();
}

export default async function AdminTransactionsPage(
  { searchParams }: { searchParams: Promise<SearchParams> },
) {
  await requireAdminUser();
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();

  const statusFilter = STATUSES.includes(params.status as TransactionStatus)
    ? (params.status as TransactionStatus)
    : "";
  const phoneFilter = params.phone?.trim() ?? "";
  const searchTerm = params.q?.trim() ?? "";
  const dateFrom = params.date_from?.trim() ?? "";
  const dateTo = params.date_to?.trim() ?? "";
  const page = normalizePage(params.page);

  let countQuery = supabase
    .from("transactions")
    .select("id", { count: "exact", head: true });
  let dataQuery = supabase
    .from("transactions")
    .select(
      "id, status, buyer_phone, seller_phone, base_amount, created_at, expires_at, requires_human",
    )
    .order("created_at", { ascending: false });

  if (statusFilter) {
    countQuery = countQuery.eq("status", statusFilter);
    dataQuery = dataQuery.eq("status", statusFilter);
  }

  if (phoneFilter) {
    const normalizedPhone = safePhoneLike(phoneFilter);
    const phoneExpression = `seller_phone.ilike.%${normalizedPhone}%,buyer_phone.ilike.%${normalizedPhone}%`;
    countQuery = countQuery.or(phoneExpression);
    dataQuery = dataQuery.or(phoneExpression);
  }

  if (dateFrom) {
    const start = `${dateFrom}T00:00:00.000Z`;
    countQuery = countQuery.gte("created_at", start);
    dataQuery = dataQuery.gte("created_at", start);
  }

  if (dateTo) {
    const end = `${dateTo}T23:59:59.999Z`;
    countQuery = countQuery.lte("created_at", end);
    dataQuery = dataQuery.lte("created_at", end);
  }

  if (searchTerm) {
    const normalizedSearch = safePhoneLike(searchTerm);
    const looksLikeUuid = /^[0-9a-fA-F-]{36}$/.test(normalizedSearch);
    const searchExpression = looksLikeUuid
      ? `id.eq.${normalizedSearch},seller_phone.ilike.%${normalizedSearch}%,buyer_phone.ilike.%${normalizedSearch}%`
      : `seller_phone.ilike.%${normalizedSearch}%,buyer_phone.ilike.%${normalizedSearch}%`;
    countQuery = countQuery.or(searchExpression);
    dataQuery = dataQuery.or(searchExpression);
  }

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  dataQuery = dataQuery.range(from, to);

  const [{ data, error }, { count, error: countError }] = await Promise.all([
    dataQuery,
    countQuery,
  ]);

  if (error) {
    throw new Error(`Failed to load transactions: ${error.message}`);
  }
  if (countError) {
    throw new Error(`Failed to count transactions: ${countError.message}`);
  }

  const transactions = (data ?? []) as TransactionListRow[];
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);

  const amountOnPage = transactions.reduce((sum, tx) => sum + Number(tx.base_amount), 0);
  const requiresHumanOnPage = transactions.filter((tx) => tx.requires_human).length;
  const statusCounts = transactions.reduce<Record<string, number>>((acc, tx) => {
    acc[tx.status] = (acc[tx.status] ?? 0) + 1;
    return acc;
  }, {});

  const previousPage = Math.max(1, currentPage - 1);
  const nextPage = Math.min(pageCount, currentPage + 1);
  const queryBase = new URLSearchParams();
  if (statusFilter) queryBase.set("status", statusFilter);
  if (phoneFilter) queryBase.set("phone", phoneFilter);
  if (searchTerm) queryBase.set("q", searchTerm);
  if (dateFrom) queryBase.set("date_from", dateFrom);
  if (dateTo) queryBase.set("date_to", dateTo);

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Transaction Management</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Filter, search, and inspect transactions for manual operations.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Back to Dashboard
        </Link>
      </header>

      <section className="mb-6 grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 md:grid-cols-4">
        <article>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Matched</p>
          <p className="text-xl font-semibold text-zinc-900">{total}</p>
        </article>
        <article>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Page Amount (USD)</p>
          <p className="text-xl font-semibold text-zinc-900">{amountOnPage.toFixed(2)}</p>
        </article>
        <article>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Requires Human</p>
          <p className="text-xl font-semibold text-zinc-900">{requiresHumanOnPage}</p>
        </article>
        <article>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Page / Total</p>
          <p className="text-xl font-semibold text-zinc-900">
            {currentPage} / {pageCount}
          </p>
        </article>
      </section>

      <form className="mb-6 grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 md:grid-cols-6">
        <input
          type="text"
          name="q"
          defaultValue={searchTerm}
          placeholder="Search by ID or phone"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-700 md:col-span-2"
        />
        <input
          type="text"
          name="phone"
          defaultValue={phoneFilter}
          placeholder="Filter phone"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-700"
        />
        <select
          name="status"
          defaultValue={statusFilter}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-700"
        >
          <option value="">All statuses</option>
          {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <input
          type="date"
          name="date_from"
          defaultValue={dateFrom}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-700"
        />
        <input
          type="date"
          name="date_to"
          defaultValue={dateTo}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-700"
        />
        <div className="md:col-span-6 flex gap-2">
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Apply Filters
          </button>
          <Link
            href="/admin/transactions"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Reset
          </Link>
        </div>
      </form>

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-left text-zinc-600">
            <tr>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Buyer</th>
              <th className="px-4 py-3 font-medium">Vendor</th>
              <th className="px-4 py-3 font-medium">Base Amount</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id} className="border-t border-zinc-100">
                <td className="px-4 py-3 font-mono text-xs text-zinc-900">{tx.id}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
                    {tx.status}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-700">{tx.buyer_phone}</td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-700">{tx.seller_phone}</td>
                <td className="px-4 py-3 text-zinc-700">${Number(tx.base_amount).toFixed(2)}</td>
                <td className="px-4 py-3 text-zinc-700">{new Date(tx.created_at).toLocaleString()}</td>
                <td className="px-4 py-3 text-zinc-700">{new Date(tx.expires_at).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/transactions/${tx.id}`}
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                  No transactions found for current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <footer className="mt-4 flex items-center justify-between">
        <p className="text-sm text-zinc-600">
          Status distribution (current page):{" "}
          {Object.keys(statusCounts).length === 0
            ? "none"
            : Object.entries(statusCounts).map(([status, value]) => `${status}: ${value}`).join(" | ")}
        </p>
        <div className="flex gap-2">
          <Link
            href={`/admin/transactions?${new URLSearchParams({ ...Object.fromEntries(queryBase), page: String(previousPage) }).toString()}`}
            className={`rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 ${
              currentPage <= 1 ? "pointer-events-none opacity-50" : "hover:bg-zinc-50"
            }`}
          >
            Previous
          </Link>
          <Link
            href={`/admin/transactions?${new URLSearchParams({ ...Object.fromEntries(queryBase), page: String(nextPage) }).toString()}`}
            className={`rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 ${
              currentPage >= pageCount ? "pointer-events-none opacity-50" : "hover:bg-zinc-50"
            }`}
          >
            Next
          </Link>
        </div>
      </footer>
    </main>
  );
}
