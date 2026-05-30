// supabase/functions/_shared/adminAlerts.ts
import { getSupabaseClient } from "./supabaseClient.ts";
import { sendWhatsAppTemplate } from "./whatsappClient.ts";

const ADMIN_PHONE = "27603960790";

const WHATSAPP_API_URL = `https://graph.facebook.com/v22.0/${Deno.env.get("WHATSAPP_PHONE_ID")}/messages`;
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN");

// Sends directly to the admin, bypassing the generic user-facing fallback in sendWhatsAppText.
// On a 24-hour window expiry (131047), falls back to the utility template with actual content.
async function sendAdminWhatsApp(message: string, type: string): Promise<void> {
    const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: ADMIN_PHONE,
        type: "text",
        text: { body: message }
    };

    const response = await fetch(WHATSAPP_API_URL, {
        method: "POST",
        headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (data.error?.code === 131047) {
        // 24-hour window is closed — use a utility template so the alert still reaches the admin.
        // Pass the alert type and the first 200 chars of the message as template parameters.
        console.warn(`[AdminAlerts] 24h window closed for admin. Sending template with alert content.`);
        await sendWhatsAppTemplate(ADMIN_PHONE, "clairtus_update", [type, message.substring(0, 200)]);
        return;
    }

    if (!response.ok) {
        throw new Error(`WhatsApp API Error ${response.status}: ${JSON.stringify(data)}`);
    }
}

export async function notifyAdmin(type: string, message: string, phone_number?: string | null, transaction_id?: string | null) {
    const supabase = getSupabaseClient();

    let emoji = "🚨";
    if (type === "SUCCESS_DEPOSIT" || type === "SUCCESS_PAYOUT") emoji = "💰";
    if (type === "HELP_NEEDED") emoji = "🙋‍♂️";
    if (type === "DISPUTE") emoji = "⚖️";

    const waMessage = `${emoji} *CLAIRTUS COMMAND*\n\n*Alerte:* ${type}\n*Détails:* ${message}\n${phone_number ? `*User:* +${phone_number}` : ""}\n${transaction_id ? `*Ref:* ${transaction_id.split("-")[0]}...` : ""}`;

    // 1. Send WhatsApp Notification (Independent Block)
    try {
        await sendAdminWhatsApp(waMessage, type);
        console.log(`[AdminAlerts] WhatsApp successfully sent to ${ADMIN_PHONE}`);
    } catch (waError) {
        console.error("[AdminAlerts] Failed to send WhatsApp:", waError);
    }

    // 2. Insert into Database for Web Portal Realtime (Independent Block)
    try {
        const { error } = await supabase.from("admin_alerts").insert({
            type,
            message,
            phone_number,
            transaction_id
        });

        if (error) throw error;
        console.log(`[AdminAlerts] Successfully logged to database`);
    } catch (dbError) {
        console.error("[AdminAlerts] Failed to log to database:", dbError);
    }
}
