import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { invokeStateMachineAction } from "@/lib/stateMachineApi";
import { createServerSupabaseClient } from "@/lib/supabase/server";

interface ActionRequestBody {
  action?: "force_payout" | "force_refund" | "resume_automation";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!user || !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id: transactionId } = await context.params;
  if (!transactionId) {
    return NextResponse.json({ error: "Missing transaction ID" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as ActionRequestBody | null;
  if (!body?.action) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  try {
    if (body.action === "force_payout") {
      const result = await invokeStateMachineAction(
        {
          action: "initiate_payout",
          transaction_id: transactionId,
        },
        session,
      );
      return NextResponse.json({ ok: true, result });
    }

    if (body.action === "force_refund") {
      const result = await invokeStateMachineAction(
        {
          action: "initiate_refund",
          transaction_id: transactionId,
          refund_reason: "USER_CANCELLED",
        },
        session,
      );
      return NextResponse.json({ ok: true, result });
    }

    if (body.action === "resume_automation") {
      const result = await invokeStateMachineAction(
        {
          action: "set_requires_human",
          transaction_id: transactionId,
          requires_human: false,
        },
        session,
      );
      return NextResponse.json({ ok: true, result });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown action failure",
      },
      { status: 500 },
    );
  }
}
