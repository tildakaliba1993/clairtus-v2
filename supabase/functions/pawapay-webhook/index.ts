// supabase/functions/pawapay-webhook/index.ts
import { getSupabaseClient } from "../_shared/supabaseClient.ts";
import { sendWhatsAppText } from "../_shared/whatsappClient.ts";
import { MESSAGES } from "../_shared/whatsappMessaging.ts";

function getNetworkName(phone: string) {
    const clean = phone.replace(/\+/g, '').replace(/\s/g, '');
    if (clean.startsWith("24399") || clean.startsWith("24397")) return "Airtel";
    if (clean.startsWith("24384") || clean.startsWith("24385") || clean.startsWith("24389")) return "Orange";
    return "M-Pesa";
}

Deno.serve(async (req: Request) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    try {
        const body = await req.json();
        console.log(`💰 [PAWAPAY WEBHOOK RECEIVED]:`, JSON.stringify(body));

        const supabase = getSupabaseClient();
        const status = body.status;

        // 🟢 SCENARIO 1: IT IS A DEPOSIT WEBHOOK
        if (body.depositId) {
            const depositId = body.depositId;
            const { data: tx, error: txError } = await supabase.from("transactions").select("*").eq("pawapay_deposit_id", depositId).single();
            if (txError || !tx) return new Response("Transaction Not Found", { status: 404 });

            if (tx.status === "FUNDED" || tx.status === "COMPLETED" || tx.status === "DISPUTED" || tx.status === "REFUNDED") {
                console.log(`🛡️ [IDEMPOTENCY] Deposit ${depositId} already processed (Status is ${tx.status}). Ignoring duplicate webhook.`);
                return new Response("Already Processed", { status: 200 });
            }

            if (tx.status === "CANCELLED" && status === "COMPLETED") {
                console.warn(`🧟 [ZOMBIE PAYMENT] Payment arrived for CANCELLED transaction ${tx.reference}. Moving to DISPUTED.`);
                const { error: zombieError } = await supabase.from("transactions").update({ status: "DISPUTED" }).eq("id", tx.id);
                if (zombieError) return new Response("Internal Error", { status: 500 });
                return new Response("Zombie Payment Flagged", { status: 200 });
            }

            if (status === "COMPLETED") {
                console.log(`✅ Deposit COMPLETED for TX: ${tx.reference}. Committing to Database...`);
                const generatedPin = Math.floor(1000 + Math.random() * 9000).toString();
                
                const { data: updatedTx, error: updateError } = await supabase
                    .from("transactions")
                    .update({ status: "FUNDED", pin_code: generatedPin })
                    .eq("id", tx.id)
                    .select()
                    .single();

                if (updateError || !updatedTx) return new Response("Internal Database Error", { status: 500 });

                await supabase.from("sessions").update({ current_state: "AWAITING_DELIVERY_BUYER" }).eq("phone_number", tx.buyer_phone);
                await sendWhatsAppText(tx.buyer_phone, MESSAGES.PAYMENT_SUCCESS_BUYER(tx.base_amount, tx.currency, generatedPin));
                await supabase.from("sessions").update({ current_state: "AWAITING_DELIVERY_SELLER" }).eq("phone_number", tx.seller_phone);
                await sendWhatsAppText(tx.seller_phone, MESSAGES.PAYMENT_SUCCESS_SELLER(tx.base_amount, tx.currency));
                
            } else if (status === "FAILED" || status === "REJECTED") {
                console.log(`❌ Deposit FAILED for TX: ${tx.reference}`);
                await supabase.from("network_events").insert({ network: getNetworkName(tx.buyer_phone), event_type: "DEPOSIT_FAILED" });
                await supabase.from("sessions").update({ current_state: "AWAITING_PAYMENT_BUYER" }).eq("phone_number", tx.buyer_phone);
                await sendWhatsAppText(tx.buyer_phone, MESSAGES.PAYMENT_FAILED_BUYER);
            }
            return new Response("Deposit Webhook Processed", { status: 200 });
        }

        // 🟢 SCENARIO 2: IT IS A PAYOUT WEBHOOK
        else if (body.payoutId) {
            const payoutId = body.payoutId;
            const { data: tx, error: txError } = await supabase.from("transactions").select("*").eq("pawapay_payout_id", payoutId).single();
            if (txError || !tx) return new Response("Transaction Not Found", { status: 404 });

            if (tx.status === "COMPLETED") {
                console.log(`🛡️ [IDEMPOTENCY] Payout ${payoutId} already processed. Ignoring duplicate webhook.`);
                return new Response("Already Processed", { status: 200 });
            }

            if (status === "COMPLETED") {
                console.log(`✅ Payout COMPLETED for TX: ${tx.reference}`);
                await supabase.from("transactions").update({ status: "COMPLETED" }).eq("id", tx.id);

                try {
                    await supabase.rpc('increment_trust_score', { phone_number_to_update: tx.seller_phone });
                    await supabase.rpc('increment_trust_score', { phone_number_to_update: tx.buyer_phone });
                    console.log(`📈 [TRUST SCORE] Incremented for ${tx.seller_phone} and ${tx.buyer_phone}`);
                } catch (scoreError) {
                    console.error("Failed to update trust scores:", scoreError);
                }

            } else if (status === "FAILED" || status === "REJECTED") {
                console.log(`❌ Payout FAILED for TX: ${tx.reference}. Reason:`, body.failureReason);
                await supabase.from("network_events").insert({ network: getNetworkName(tx.seller_phone), event_type: "PAYOUT_FAILED" });
                
                // 🔧 UAT FIX: Explicitly set status to PAYOUT_FAILED so the State Machine catches it
                await supabase.from("transactions").update({ status: "PAYOUT_FAILED", pawapay_payout_id: null }).eq("id", tx.id);
                await supabase.from("sessions").upsert({ phone_number: tx.seller_phone, current_state: "AWAITING_NEW_PAYOUT_NUMBER", draft_transaction_id: tx.id }, { onConflict: 'phone_number' });
                await sendWhatsAppText(tx.seller_phone, `⚠️ *Échec du Transfert*\n\nL'opérateur a rejeté l'envoi de vos fonds. Raison possible: limite de solde atteinte ou compte inactif.\n\nVeuillez envoyer un **nouveau numéro Mobile Money** (ex: 243...) pour recevoir votre argent, ou tapez *RÉESSAYER* si vous avez vidé votre compte.`);
            }
            return new Response("Payout Webhook Processed", { status: 200 });
        }

        return new Response("Invalid Payload Type", { status: 400 });
    } catch (error) {
        console.error("Webhook Error:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
});