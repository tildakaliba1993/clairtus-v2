import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { getFloatSnapshot } from "@/lib/floatMonitoring";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get("force_refresh") === "1";

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const snapshot = await getFloatSnapshot(supabase);

    return NextResponse.json({
      ok: true,
      force_refresh: forceRefresh,
      ...snapshot,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown monitoring error" },
      { status: 500 },
    );
  }
}
