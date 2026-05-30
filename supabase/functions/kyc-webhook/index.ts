// supabase/functions/kyc-webhook/index.ts
// Triggered by a Supabase Database Webhook on UPDATE to the users table.
// Sends a French WhatsApp notification to the user whenever their kyc_status changes.
// This fires after the Smile ID callback updates the status — it is the user's notification endpoint.

import { getSupabaseClient } from "../_shared/supabaseClient.ts";
import { sendWhatsAppText } from "../_shared/whatsappClient.ts";

Deno.serve(async (req: Request) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    try {
        const payload = await req.json();
        console.log("[KYC Webhook] Received:", JSON.stringify(payload));

        if (payload.type !== "UPDATE" || payload.table !== "users") {
            return new Response("Not relevant", { status: 200 });
        }

        const oldRecord = payload.old_record;
        const newRecord = payload.record;
        const phone     = newRecord.phone_number;
        const oldStatus = oldRecord?.kyc_status;
        const newStatus = newRecord?.kyc_status;

        if (!phone || oldStatus === newStatus) {
            return new Response("No status change", { status: 200 });
        }

        console.log(`[KYC Webhook] +${phone}: ${oldStatus} → ${newStatus}`);

        const supabase = getSupabaseClient();

        if (newStatus === "VERIFIED") {
            // Reset session so user can immediately resume their transaction.
            await supabase
                .from("sessions")
                .update({ current_state: "MAIN_MENU" })
                .eq("phone_number", phone)
                .in("current_state", ["AWAITING_KYC_COMPLETION"]);

            await sendWhatsAppText(phone,
                `✅ *Identité Vérifiée avec Succès !*\n\n` +
                `Félicitations ! Votre identité a été authentifiée par nos systèmes de vérification sécurisés (Smile ID).\n\n` +
                `🔓 *Toutes les limites de votre compte sont levées.* Vous pouvez désormais effectuer des transactions sans plafond.\n\n` +
                `Tapez *BONJOUR* pour reprendre votre transaction.`
            );

        } else if (newStatus === "REJECTED") {
            const kycBase = Deno.env.get("KYC_BASE_URL") ?? "https://clairtus.com";
            const link    = `${kycBase}/kyc?phone=${encodeURIComponent(phone)}`;

            await sendWhatsAppText(phone,
                `❌ *Vérification Échouée*\n\n` +
                `Votre identité n'a pas pu être confirmée. Raisons possibles :\n` +
                `• Photo de document floue ou mal cadrée\n` +
                `• Document expiré ou non valide en RDC\n` +
                `• Éclairage insuffisant lors du selfie\n\n` +
                `👉 *Réessayez ici :*\n${link}\n\n` +
                `Assurez-vous d'utiliser votre *Carte d'Électeur Nationale* ou votre *Passeport* dans un endroit bien éclairé.`
            );

        } else if (newStatus === "UNVERIFIED") {
            await sendWhatsAppText(phone,
                `⚠️ *Statut de Vérification Réinitialisé*\n\n` +
                `Votre statut de vérification a été réinitialisé par notre équipe.\n` +
                `Les limites de sécurité standard s'appliquent à nouveau.\n\n` +
                `Tapez *BONJOUR* pour continuer.`
            );

        } else if (newStatus === "PENDING") {
            // User has initiated verification — no notification needed here,
            // sendKYCVerificationLink already sent the WhatsApp message.
            console.log(`[KYC Webhook] Status set to PENDING for +${phone} — no additional notification.`);
        }

        return new Response("OK", { status: 200 });
    } catch (err) {
        console.error("[KYC Webhook] Error:", err);
        return new Response("Internal Server Error", { status: 500 });
    }
});
