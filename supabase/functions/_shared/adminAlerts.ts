import { getSupabaseClient } from "./supabaseClient.ts";
import { sendWhatsAppText } from "./whatsappClient.ts";

const ADMIN_PHONE = "27603960790"; // Your WhatsApp number

export async function notifyAdmin(type: string, message: string, phone_number?: string | null, transaction_id?: string | null) {
    const supabase = getSupabaseClient();
    
    try {
        // 1. Insert into database for Realtime Admin Dashboard 
        // (Will fail silently if table doesn't exist yet, which is safe until you run the SQL)
        await supabase.from("admin_alerts").insert({
            type,
            message,
            phone_number,
            transaction_id
        });

        // 2. Send WhatsApp Notification to You
        let emoji = "🚨";
        if (type === "SUCCESS_DEPOSIT" || type === "SUCCESS_PAYOUT") emoji = "💰";
        if (type === "HELP_NEEDED") emoji = "🙋‍♂️";
        if (type === "DISPUTE") emoji = "⚖️";

        const waMessage = `${emoji} *CLAIRTUS ADMIN ALERT*\n\n*Type:* ${type}\n*Message:* ${message}\n${phone_number ? `*User:* +${phone_number}` : ""}\n${transaction_id ? `*TX ID:* ${transaction_id.split('-')[0]}...` : ""}`;
        
        await sendWhatsAppText(ADMIN_PHONE, waMessage);
    } catch (e) {
        console.error("Failed to trigger admin notification", e);
    }
}
