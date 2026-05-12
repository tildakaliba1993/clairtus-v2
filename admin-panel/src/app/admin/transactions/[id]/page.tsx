import Link from "next/link";
import { notFound } from "next/navigation";
import { TransactionActionPanel } from "@/components/transaction-action-panel";
import { requireAdminUser } from "@/lib/auth-guards";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type TransactionStatus =
  | "INITIATED"
  | "PENDING_FUNDING"
  | "SECURED"
  | "COMPLETED"
  | "CANCELLED"
  | "PIN_FAILED_LOCKED"
  | "PAYOUT_FAILED"
  | "PAYOUT_DELAYED"
  | "HUMAN_SUPPORT";

interface TransactionDetailRow {
  id: string;
  status: TransactionStatus;
  buyer_phone: string;
  seller_phone: string;
  initiator_phone: string;
  item_description: string;
  currency: string;
  base_amount: number;
  mno_fee: number;
  clairtus_fee: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
  requires_human: boolean;
  secret_pin: string | null;
  pawapay_deposit_id: string | null;
  pawapay_payout_id: string | null;
  pawapay_refund_id: string | null;
}

interface StatusLogRow {
  id: number;
  old_status: string | null;
  new_status: string;
  event: string | null;
  reason: string | null;
  changed_at: string;
  changed_by: string;
}

interface ErrorLogRow {
  id: number;
  error_type: string;
  error_message: string;
  error_details: Record<string, unknown> | null;
  occurred_at: string;
  resolved: boolean;
}

function buildPawaPayReferenceLink(reference: string | null): string | null {
  if (!reference) {
    return null;
  }

  const baseUrl = process.env.PAWAPAY_DASHBOARD_BASE_URL?.trim();
  if (baseUrl) {
    return `${baseUrl.replace(/\/$/, "")}/search?q=${encodeURIComponent(reference)}`;
  }

  return `https://api.sandbox.pawapay.io/v1/${encodeURIComponent(reference)}`;
}

export default async function AdminTransactionDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdminUser();
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const [{ data: txData, error: txError }, { data: statusLog, error: statusLogError }, {
    data: errors,
    error: errorsError,
  }] = await Promise.all([
    supabase
      .from("transactions")
      .select(
        "id, status, buyer_phone, seller_phone, initiator_phone, item_description, currency, base_amount, mno_fee, clairtus_fee, created_at, updated_at, expires_at, requires_human, secret_pin, pawapay_deposit_id, pawapay_payout_id, pawapay_refund_id",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("transaction_status_log")
      .select("id, old_status, new_status, event, reason, changed_at, changed_by")
      .eq("transaction_id", id)
      .order("changed_at", { ascending: false }),
    supabase
      .from("error_logs")
      .select("id, error_type, error_message, error_details, occurred_at, resolved")
      .eq("transaction_id", id)
      .order("occurred_at", { ascending: false })
      .limit(100),
  ]);

  if (txError) {
    throw new Error(`Failed to load transaction detail: ${txError.message}`);
  }
  if (!txData) {
    notFound();
  }
  if (statusLogError) {
    throw new Error(`Failed to load status history: ${statusLogError.message}`);
  }
  if (errorsError) {
    throw new Error(`Failed to load error logs: ${errorsError.message}`);
  }

  const tx = txData as TransactionDetailRow;
  const historyRows = (statusLog ?? []) as StatusLogRow[];
  const errorRows = (errors ?? []) as ErrorLogRow[];

  const canForcePayout = tx.status === "SECURED" || tx.status === "PAYOUT_FAILED";
  const canForceRefund = tx.status === "SECURED" ||
    tx.status === "PAYOUT_FAILED" ||
    tx.status === "PIN_FAILED_LOCKED";
  const canResumeAutomation = tx.requires_human;

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Transaction Detail</h1>
          <p className="mt-1 font-mono text-xs text-zinc-600">{tx.id}</p>
        </div>
        <Link
          href="/admin/transactions"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Back to List
        </Link>
      </header>

      <section className="mb-6 grid gap-4 rounded-lg border border-zinc-200 bg-white p-5 md:grid-cols-2">
        <article>
          <h2 className="text-lg font-semibold text-zinc-900">Core Data</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="text-zinc-500">Status</dt><dd className="font-medium">{tx.status}</dd></div>
            <div><dt className="text-zinc-500">Buyer</dt><dd className="font-mono text-xs">{tx.buyer_phone}</dd></div>
            <div><dt className="text-zinc-500">Vendor</dt><dd className="font-mono text-xs">{tx.seller_phone}</dd></div>
            <div><dt className="text-zinc-500">Initiator</dt><dd className="font-mono text-xs">{tx.initiator_phone}</dd></div>
            <div><dt className="text-zinc-500">Item</dt><dd>{tx.item_description}</dd></div>
            <div><dt className="text-zinc-500">Requires Human</dt><dd>{tx.requires_human ? "true" : "false"}</dd></div>
            <div><dt className="text-zinc-500">Secret PIN</dt><dd className="font-mono">{tx.secret_pin ?? "-"}</dd></div>
          </dl>
        </article>

        <article>
          <h2 className="text-lg font-semibold text-zinc-900">Amounts & References</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="text-zinc-500">Currency</dt><dd>{tx.currency}</dd></div>
            <div><dt className="text-zinc-500">Base Amount</dt><dd>${Number(tx.base_amount).toFixed(2)}</dd></div>
            <div><dt className="text-zinc-500">MNO Fee</dt><dd>${Number(tx.mno_fee).toFixed(2)}</dd></div>
            <div><dt className="text-zinc-500">Clairtus Fee</dt><dd>${Number(tx.clairtus_fee).toFixed(2)}</dd></div>
            <div>
              <dt className="text-zinc-500">PawaPay Deposit ID</dt>
              <dd className="font-mono text-xs">
                {tx.pawapay_deposit_id
                  ? (
                    <a
                      href={buildPawaPayReferenceLink(tx.pawapay_deposit_id) ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-700 underline"
                    >
                      {tx.pawapay_deposit_id}
                    </a>
                  )
                  : "-"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">PawaPay Payout ID</dt>
              <dd className="font-mono text-xs">
                {tx.pawapay_payout_id
                  ? (
                    <a
                      href={buildPawaPayReferenceLink(tx.pawapay_payout_id) ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-700 underline"
                    >
                      {tx.pawapay_payout_id}
                    </a>
                  )
                  : "-"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">PawaPay Refund ID</dt>
              <dd className="font-mono text-xs">
                {tx.pawapay_refund_id
                  ? (
                    <a
                      href={buildPawaPayReferenceLink(tx.pawapay_refund_id) ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-700 underline"
                    >
                      {tx.pawapay_refund_id}
                    </a>
                  )
                  : "-"}
              </dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-zinc-900">Timestamps</h2>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
          <p><span className="text-zinc-500">Created:</span> {new Date(tx.created_at).toLocaleString()}</p>
          <p><span className="text-zinc-500">Updated:</span> {new Date(tx.updated_at).toLocaleString()}</p>
          <p><span className="text-zinc-500">Expires:</span> {new Date(tx.expires_at).toLocaleString()}</p>
        </div>
      </section>

      <div className="mb-6">
        <TransactionActionPanel
          transactionId={tx.id}
          canForcePayout={canForcePayout}
          canForceRefund={canForceRefund}
          canResumeAutomation={canResumeAutomation}
        />
      </div>

      <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-zinc-900">Status History</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Changed At</th>
                <th className="py-2 pr-3 font-medium">Old</th>
                <th className="py-2 pr-3 font-medium">New</th>
                <th className="py-2 pr-3 font-medium">Event</th>
                <th className="py-2 pr-3 font-medium">Reason</th>
                <th className="py-2 pr-3 font-medium">Changed By</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((row) => (
                <tr key={row.id} className="border-t border-zinc-100">
                  <td className="py-2 pr-3">{new Date(row.changed_at).toLocaleString()}</td>
                  <td className="py-2 pr-3">{row.old_status ?? "-"}</td>
                  <td className="py-2 pr-3">{row.new_status}</td>
                  <td className="py-2 pr-3">{row.event ?? "-"}</td>
                  <td className="py-2 pr-3">{row.reason ?? "-"}</td>
                  <td className="py-2 pr-3">{row.changed_by}</td>
                </tr>
              ))}
              {historyRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-zinc-500">No history rows.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-zinc-900">Error Logs</h2>
        <div className="mt-3 space-y-3">
          {errorRows.map((row) => (
            <article key={row.id} className="rounded-md border border-zinc-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-zinc-900">{row.error_type}</p>
                <p className="text-xs text-zinc-500">{new Date(row.occurred_at).toLocaleString()}</p>
              </div>
              <p className="mt-1 text-sm text-zinc-700">{row.error_message}</p>
              <p className="mt-1 text-xs text-zinc-500">Resolved: {row.resolved ? "yes" : "no"}</p>
              {row.error_details ? (
                <pre className="mt-2 overflow-x-auto rounded bg-zinc-100 p-2 text-xs text-zinc-700">
                  {JSON.stringify(row.error_details, null, 2)}
                </pre>
              ) : null}
            </article>
          ))}
          {errorRows.length === 0 ? <p className="text-sm text-zinc-500">No errors logged.</p> : null}
        </div>
      </section>
    </main>
  );
}
