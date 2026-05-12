import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { isAdminEmail } from "./admin";
import { createServerSupabaseClient } from "./supabase/server";

export async function requireAuthenticatedUser(redirectTo = "/login"): Promise<User> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(redirectTo);
  }

  return user;
}

export async function requireAdminUser(): Promise<User> {
  const user = await requireAuthenticatedUser();
  if (!isAdminEmail(user.email)) {
    redirect("/dashboard?error=admin_access_required");
  }

  return user;
}
