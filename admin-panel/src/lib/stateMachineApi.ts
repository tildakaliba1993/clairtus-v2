import type { Session } from "@supabase/supabase-js";

type StateMachineAction = "initiate_payout" | "initiate_refund" | "set_requires_human";

interface InvokePayloadBase {
  action: StateMachineAction;
  transaction_id: string;
}

interface PayoutPayload extends InvokePayloadBase {
  action: "initiate_payout";
}

interface RefundPayload extends InvokePayloadBase {
  action: "initiate_refund";
  refund_reason: "USER_CANCELLED";
}

interface ResumeAutomationPayload extends InvokePayloadBase {
  action: "set_requires_human";
  requires_human: false;
}

type InvokePayload = PayoutPayload | RefundPayload | ResumeAutomationPayload;

export async function invokeStateMachineAction(
  payload: InvokePayload,
  session: Session,
): Promise<Record<string, unknown>> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY for function invocation.",
    );
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/state-machine`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = typeof body?.error === "string"
      ? body.error
      : `State machine call failed (${response.status}).`;
    throw new Error(message);
  }

  return body ?? {};
}
