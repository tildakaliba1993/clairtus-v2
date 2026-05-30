// supabase/functions/smile-id-callback/index.ts
// Receives async POST notifications from Smile ID when document verification is complete.
// Verifies the HMAC signature to reject spoofed requests.
// Updates the user's kyc_status, which automatically triggers the kyc-webhook
// database trigger that sends the user their French WhatsApp notification.

import { getSupabaseClient } from "../_shared/supabaseClient.ts";
import { verifySmileSignature, resultCodeToStatus } from "../_shared/smileIdClient.ts";

Deno.serve(async (req: Request) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    try {
        const body = await req.json();
        console.log("[SmileID Callback] Received:", JSON.stringify(body));

        const { timestamp, signature, PartnerParams, ResultCode, ResultText, IsFinalResult, SmileJobID } = body;

        // Reject callbacks without a verifiable signature.
        if (!timestamp || !signature) {
            console.error("[SmileID Callback] Missing timestamp or signature.");
            return new Response("Bad Request", { status: 400 });
        }

        const valid = await verifySmileSignature(timestamp, signature);
        if (!valid) {
            console.error("[SmileID Callback] Signature mismatch — possible spoofed request.");
            return new Response("Unauthorized", { status: 401 });
        }

        // Smile ID may send intermediate callbacks; only act on the final result.
        if (IsFinalResult !== "true") {
            console.log("[SmileID Callback] Intermediate result — ignoring.");
            return new Response("OK", { status: 200 });
        }

        const userPhone = PartnerParams?.user_id;
        if (!userPhone) {
            console.error("[SmileID Callback] No user_id in PartnerParams.");
            return new Response("Bad Request", { status: 400 });
        }

        const newStatus = resultCodeToStatus(ResultCode);
        const supabase  = getSupabaseClient();

        const { error } = await supabase
            .from("users")
            .update({
                kyc_status:        newStatus,
                kyc_smile_job_id:  SmileJobID   ?? null,
                kyc_result_code:   ResultCode   ?? null,
            })
            .eq("phone_number", userPhone);

        if (error) {
            console.error("[SmileID Callback] DB update error:", error);
            return new Response("Internal Server Error", { status: 500 });
        }

        console.log(`[SmileID Callback] +${userPhone}: ${ResultCode} (${ResultText ?? "—"}) → ${newStatus}`);

        // Also reset the user's WhatsApp session state so they can continue transacting.
        await supabase
            .from("sessions")
            .update({ current_state: "MAIN_MENU" })
            .eq("phone_number", userPhone)
            .in("current_state", ["AWAITING_KYC_COMPLETION"]);

        return new Response("OK", { status: 200 });

    } catch (err) {
        console.error("[SmileID Callback] Unhandled error:", err);
        return new Response("Internal Server Error", { status: 500 });
    }
});
