// supabase/functions/_shared/adminAlerts.ts
import { getSupabaseClient } from "./supabaseClient.ts";
import { sendWhatsAppText } from "./whatsappClient.ts";

const ADMIN_PHONE = "27603960790"; // Your precise WhatsApp number

export async function notifyAdmin(type: string, message: string, phone_number?: string | null, transaction_id?: string | null) {
    const supabase = getSupabaseClient();
    
    // 1. Send WhatsApp Notification (Independent Block)
    try {
        let emoji = "🚨";
        if (type === "SUCCESS_DEPOSIT" || type === "SUCCESS_PAYOUT") emoji = "💰";
        if (type === "HELP_NEEDED") emoji = "🙋‍♂️";
        if (type === "DISPUTE") emoji = "⚖️";

        const waMessage = `${emoji} *CLAIRTUS COMMAND*\n\n*Alerte:* ${type}\n*Détails:* ${message}\n${phone_number ? `*User:* +${phone_number}` : ""}\n${transaction_id ? `*Ref:* ${transaction_id.split('-')[0]}...` : ""}`;
        
        await sendWhatsAppText(ADMIN_PHONE, waMessage);
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