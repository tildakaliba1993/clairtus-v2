import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const typeFilter = (url.searchParams.get("type") ?? "").trim();
  const resolvedFilter = (url.searchParams.get("resolved") ?? "").trim();
  const fromDate = (url.searchParams.get("from") ?? "").trim();
  const toDate = (url.searchParams.get("to") ?? "").trim();

  let query = supabase
    .from("error_logs")
    .select("id, error_type, error_message, occurred_at, resolved, transaction_id")
    .order("occurred_at", { ascending: false })
    .limit(5000);

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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const headers = [
    "id",
    "error_type",
    "error_message",
    "occurred_at",
    "resolved",
    "transaction_id",
  ];
  const rows = (data ?? []).map((row) => {
    const typed = row as {
      id: number;
      error_type: string;
      error_message: string;
      occurred_at: string;
      resolved: boolean;
      transaction_id: string | null;
    };
    return [
      String(typed.id),
      typed.error_type,
      typed.error_message,
      typed.occurred_at,
      typed.resolved ? "true" : "false",
      typed.transaction_id ?? "",
    ].map(escapeCsvField).join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clairtus_error_logs_${Date.now()}.csv"`,
    },
  });
}
