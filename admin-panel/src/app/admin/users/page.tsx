import { revalidatePath } from "next/cache";
import { requireAdminUser } from "@/lib/auth-guards";
import { createServerSupabaseClient } from "@/lib/supabase/server";

interface PlatformUserRow {
  phone_number: string;
  is_suspended: boolean;
  successful_transactions: number;
  cancelled_transactions: number;
  created_at: string;
}

export default async function AdminUsersPage() {
  await requireAdminUser();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("users")
    .select(
      "phone_number, is_suspended, successful_transactions, cancelled_transactions, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Failed to load users: ${error.message}`);
  }

  const users = (data ?? []) as PlatformUserRow[];

  async function updateSuspension(formData: FormData) {
    "use server";

    await requireAdminUser();
    const phoneNumber = String(formData.get("phone_number") ?? "");
    const nextState = String(formData.get("next_state") ?? "");
    const isSuspended = nextState === "suspended";

    if (!phoneNumber) {
      throw new Error("Missing phone number.");
    }

    const serverSupabase = await createServerSupabaseClient();
    const { error: updateError } = await serverSupabase
      .from("users")
      .update({ is_suspended: isSuspended })
      .eq("phone_number", phoneNumber);

    if (updateError) {
      throw new Error(`Failed to update suspension: ${updateError.message}`);
    }

    revalidatePath("/admin/users");
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">Admin User Management</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Manage platform users and suspension status for abuse prevention workflows.
        </p>
      </header>

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-left text-zinc-600">
            <tr>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Suspended</th>
              <th className="px-4 py-3 font-medium">Success</th>
              <th className="px-4 py-3 font-medium">Cancelled</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.phone_number} className="border-t border-zinc-100">
                <td className="px-4 py-3 font-mono text-xs text-zinc-900">{user.phone_number}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      user.is_suspended
                        ? "bg-red-100 text-red-700"
                        : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    {user.is_suspended ? "Yes" : "No"}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-700">{user.successful_transactions}</td>
                <td className="px-4 py-3 text-zinc-700">{user.cancelled_transactions}</td>
                <td className="px-4 py-3 text-zinc-700">
                  {new Date(user.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <form action={updateSuspension}>
                    <input type="hidden" name="phone_number" value={user.phone_number} />
                    <input
                      type="hidden"
                      name="next_state"
                      value={user.is_suspended ? "active" : "suspended"}
                    />
                    <button
                      type="submit"
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      {user.is_suspended ? "Unsuspend" : "Suspend"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  No users found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </main>
  );
}
