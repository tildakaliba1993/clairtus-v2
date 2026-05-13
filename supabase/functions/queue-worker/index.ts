// supabase/functions/queue-worker/index.ts
import { getSupabaseClient } from "../_shared/supabaseClient.ts";
import { initiatePawaPayDeposit } from "../_shared/pawapayClient.ts";
import { sendWhatsAppText } from "../_shared/whatsappClient.ts"; 

Deno.serve(async (req: Request) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    try {
        const payload = await req.json();
        console.log("👷 [QUEUE WORKER] Woke up! Received payload:", payload);

        const job = payload.record; 
        
        if (!job || !job.id || !job.transaction_id) {
            return new Response("Invalid job payload", { status: 400 });
        }

        const supabase = getSupabaseClient();

        await supabase.from("payment_queue").update({ status: "PROCESSING" }).eq("id", job.id);

        try {
            console.log(`👷 [QUEUE WORKER] Firing PawaPay Deposit for phone: ${job.phone_number}`);
            
            const depositId = crypto.randomUUID();
            await initiatePawaPayDeposit(depositId, job.phone_number, job.amount, job.currency);
            
            await supabase.from("transactions").update({ pawapay_deposit_id: depositId }).eq("id", job.transaction_id);
            
            await supabase.from("payment_queue").update({ status: "COMPLETED" }).eq("id", job.id);
            console.log(`✅ [QUEUE WORKER] Job ${job.id} completed successfully.`);

        } catch (apiError) {
            console.error(`❌ [QUEUE WORKER] PawaPay API Error:`, apiError);
            
            if (job.retry_count < 3) {
                const nextRetry = new Date(Date.now() + 60000); // Retry in 60 seconds
                await supabase.from("payment_queue").update({ 
                    status: "PENDING", 
                    retry_count: job.retry_count + 1,
                    next_retry_at: nextRetry.toISOString()
                }).eq("id", job.id);
                console.log(`⏳ [QUEUE WORKER] Scheduled retry ${job.retry_count + 1} for job ${job.id}`);
            } else {
                await supabase.from("payment_queue").update({ status: "FAILED" }).eq("id", job.id);
                console.log(`💀 [QUEUE WORKER] Job ${job.id} failed after maximum retries. Triggering Dead Letter protocol.`);

                await supabase.from("sessions").update({ current_state: "AWAITING_PAYMENT_BUYER" }).eq("phone_number", job.phone_number);
                
                await sendWhatsAppText(
                    job.phone_number, 
                    `❌ *Échec critique du réseau.*\n\nNous avons tenté de joindre l'opérateur à plusieurs reprises sans succès. Vos fonds n'ont pas été débités.\n\nVeuillez réessayer plus tard en tapant *RÉESSAYER*.`
                );
            }
        }

        return new Response("Job Processed", { status: 200 });

    } catch (error) {
        console.error("Queue Worker Fatal Error:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
});