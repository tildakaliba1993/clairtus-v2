// supabase/functions/kyc-webhook/index.ts

import { sendWhatsAppText } from "../_shared/whatsappClient.ts";

Deno.serve(async (req: Request) => {
    // Only accept POST requests from Supabase Database Webhooks
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    try {
        const payload = await req.json();
        console.log("🕵️‍♂️ [KYC WEBHOOK] Database update detected:", JSON.stringify(payload));
        
        // Ensure this is an UPDATE event on the users table
        if (payload.type === "UPDATE" && payload.table === "users") {
            const oldRecord = payload.old_record;
            const newRecord = payload.record;

            const phone = newRecord.phone_number;
            const oldStatus = oldRecord.kyc_status;
            const newStatus = newRecord.kyc_status;

            // Only trigger if the status ACTUALLY changed
            if (oldStatus !== newStatus) {
                if (newStatus === "VERIFIED") {
                    await sendWhatsAppText(phone, "✅ *Félicitations !*\n\nVotre identité a été vérifiée avec succès. Toutes les limites de votre compte sont désormais levées.\n\nTapez *BONJOUR* pour reprendre vos transactions.");
                } else if (newStatus === "REJECTED") {
                    await sendWhatsAppText(phone, "❌ *Vérification échouée*\n\nNous n'avons pas pu valider votre document d'identité (image floue, document invalide ou nom incorrect).\n\nLes limites de sécurité restent actives. Tapez *BONJOUR* et effectuez une nouvelle transaction pour soumettre une photo claire.");
                } else if (newStatus === "UNVERIFIED") {
                    // 🛡️ NEW: Notification for downgrades/revocations
                    await sendWhatsAppText(phone, "⚠️ *Statut révoqué*\n\nVotre statut de vérification a été réinitialisé. Les limites de sécurité de base sont de nouveau appliquées à votre compte.\n\nTapez *BONJOUR* pour continuer.");
                }
            }
        }

        return new Response("Webhook processed", { status: 200 });
    } catch (error) {
        console.error("❌ KYC Webhook error:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
});