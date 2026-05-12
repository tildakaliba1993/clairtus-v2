import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminEmail } from "@/lib/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  async function signOut() {
    "use server";
    const serverSupabase = await createServerSupabaseClient();
    await serverSupabase.auth.signOut();
    redirect("/login");
  }

  const adminAccess = isAdminEmail(user.email);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Clairtus Admin Panel</h1>
          <p className="text-sm text-zinc-600">Signed in as {user.email}</p>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Logout
          </button>
        </form>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-zinc-900">Authentication</h2>
          <p className="mt-2 text-sm text-zinc-600">
            Supabase Auth session is active. Middleware protects private routes.
          </p>
        </article>
        <article className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-zinc-900">Admin Access</h2>
          <p className="mt-2 text-sm text-zinc-600">
            {adminAccess
              ? "This account is in the admin allowlist."
              : "This account is not in the admin allowlist."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/admin/users"
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
            >
              Open User Management
            </Link>
            <Link
              href="/admin/transactions"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Open Transactions
            </Link>
            <Link
              href="/admin/messages"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Open Messaging
            </Link>
            <Link
              href="/admin/dashboard"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Open Monitoring
            </Link>
            <Link
              href="/admin/errors"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Open Error Logs
            </Link>
          </div>
        </article>
      </section>
    </main>
  );
}
