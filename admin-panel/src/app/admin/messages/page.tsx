import Link from "next/link";
import { MessageComposer } from "@/components/message-composer";
import { requireAdminUser } from "@/lib/auth-guards";
import { createServerSupabaseClient } from "@/lib/supabase/server";

interface MessageLogRow {
  id: number;
  recipient_phone: string;
  message_text: string;
  sent_at: string;
  sent_by: string;
  whatsapp_message_id: string | null;
  delivery_status: string;
}

interface SearchParams {
  phone?: string;
}

export default async function AdminMessagesPage(
  { searchParams }: { searchParams: Promise<SearchParams> },
) {
  await requireAdminUser();
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();

  const phoneFilter = params.phone?.trim() ?? "";
  let query = supabase
    .from("messages_log")
    .select(
      "id, recipient_phone, message_text, sent_at, sent_by, whatsapp_message_id, delivery_status",
    )
    .order("sent_at", { ascending: false })
    .limit(200);

  if (phoneFilter) {
    query = query.eq("recipient_phone", phoneFilter);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load message history: ${error.message}`);
  }

  const history = (data ?? []) as MessageLogRow[];

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Custom Messaging</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Send operational WhatsApp messages and review per-user history.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Back to Dashboard
          </Link>
          <Link
            href="/admin/messages"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Reset
          </Link>
        </div>
      </header>

      <div className="mb-6">
        <MessageComposer defaultRecipientPhone={phoneFilter} />
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-zinc-900">Message History</h2>
        <form className="mt-3 flex flex-wrap items-center gap-2">
          <input
            name="phone"
            defaultValue={phoneFilter}
            placeholder="Filter by exact +243 phone"
            className="w-full max-w-sm rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-700"
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Apply
          </button>
        </form>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-3 py-2 font-medium">Sent At</th>
                <th className="px-3 py-2 font-medium">Recipient</th>
                <th className="px-3 py-2 font-medium">Message</th>
                <th className="px-3 py-2 font-medium">Sender</th>
                <th className="px-3 py-2 font-medium">Delivery</th>
                <th className="px-3 py-2 font-medium">WhatsApp ID</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id} className="border-t border-zinc-100">
                  <td className="px-3 py-2 text-zinc-700">{new Date(row.sent_at).toLocaleString()}</td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-700">{row.recipient_phone}</td>
                  <td className="px-3 py-2 text-zinc-700">{row.message_text}</td>
                  <td className="px-3 py-2 text-zinc-700">{row.sent_by}</td>
                  <td className="px-3 py-2 text-zinc-700">{row.delivery_status}</td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-700">
                    {row.whatsapp_message_id ?? "-"}
                  </td>
                </tr>
              ))}
              {history.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                    No messages logged for this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
