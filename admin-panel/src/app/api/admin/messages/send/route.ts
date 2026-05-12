import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { normalizeDrPhoneToE164 } from "@/lib/phone";
import { createServerSupabaseClient } from "@/lib/supabase/server";

interface SendMessageRequestBody {
  recipient_phone?: string;
  message_text?: string;
}

interface MetaSendMessageResponse {
  messages?: Array<{
    id?: string;
  }>;
}

function sanitizeMessageText(input: string): string {
  return input.trim();
}

async function sendWhatsAppTextMessage(input: {
  recipientPhoneE164: string;
  messageText: string;
}): Promise<{ whatsappMessageId: string | null }> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_API_VERSION ?? "v18.0";

  if (!accessToken || !phoneNumberId) {
    throw new Error(
      "Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID in admin-panel env.",
    );
  }

  const response = await fetch(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: input.recipientPhoneE164,
        type: "text",
        text: {
          body: input.messageText,
        },
      }),
    },
  );

  const responseBody = (await response.json().catch(() => null)) as MetaSendMessageResponse | {
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    const metaErr =
      responseBody !== null &&
      typeof responseBody === "object" &&
      "error" in responseBody
        ? (
            responseBody as { error?: { message?: string } }
          ).error?.message ?? null
        : null;
    throw new Error(
      metaErr ?? `Meta send message failed with status ${response.status}.`,
    );
  }

  const whatsappMessageId =
    (responseBody as MetaSendMessageResponse | null)?.messages?.[0]?.id ?? null;
  return { whatsappMessageId };
}

export async function POST(request: Request) {
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

  const body = (await request.json().catch(() => null)) as SendMessageRequestBody | null;
  const recipientPhoneRaw = body?.recipient_phone?.trim() ?? "";
  const messageTextRaw = body?.message_text ?? "";
  const messageText = sanitizeMessageText(messageTextRaw);

  if (!recipientPhoneRaw || !messageText) {
    return NextResponse.json(
      { error: "recipient_phone and message_text are required." },
      { status: 400 },
    );
  }

  if (messageText.length > 4096) {
    return NextResponse.json(
      { error: "Message too long. Maximum 4096 characters." },
      { status: 400 },
    );
  }

  let recipientPhoneE164: string;
  try {
    recipientPhoneE164 = normalizeDrPhoneToE164(recipientPhoneRaw);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid phone format" },
      { status: 400 },
    );
  }

  const sentBy = user.email ?? user.id;
  try {
    const { whatsappMessageId } = await sendWhatsAppTextMessage({
      recipientPhoneE164,
      messageText,
    });

    const { error: logError } = await supabase.from("messages_log").insert({
      transaction_id: null,
      recipient_phone: recipientPhoneE164,
      message_text: messageText,
      sent_by: sentBy,
      whatsapp_message_id: whatsappMessageId,
      delivery_status: "SENT",
    });

    if (logError) {
      throw new Error(`Message sent but failed to log in database: ${logError.message}`);
    }

    return NextResponse.json({
      ok: true,
      recipient_phone: recipientPhoneE164,
      whatsapp_message_id: whatsappMessageId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown send failure";
    await supabase.from("error_logs").insert({
      transaction_id: null,
      error_type: "ADMIN_CUSTOM_MESSAGE_SEND_FAILED",
      error_message: errorMessage,
      error_details: {
        component: "admin-panel/api/admin/messages/send",
        recipient_phone: recipientPhoneE164,
      },
    });

    return NextResponse.json(
      { ok: false, error: errorMessage, recipient_phone: recipientPhoneE164 },
      { status: 500 },
    );
  }
}
