// supabase/functions/_shared/smileIdClient.ts
// Server-side only. API credentials are read from Supabase secrets and never sent to browsers.

const PARTNER_ID   = Deno.env.get("SMILE_ID_PARTNER_ID") ?? "";
const API_KEY      = Deno.env.get("SMILE_ID_API_KEY") ?? "";
const SANDBOX      = Deno.env.get("SMILE_ID_SANDBOX") !== "false"; // defaults to sandbox until explicitly "false"
const BASE_URL     = SANDBOX
    ? "https://testapi.smileidentity.com"
    : "https://api.smileidentity.com";

// HMAC-SHA256 of `${timestamp}${partner_id}sid_request`, base64-encoded.
// Used both to sign outgoing requests and to verify incoming Smile ID callbacks.
export async function generateSmileSignature(timestamp: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(API_KEY),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const raw = await crypto.subtle.sign(
        "HMAC",
        key,
        enc.encode(`${timestamp}${PARTNER_ID}sid_request`)
    );
    return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

export async function verifySmileSignature(timestamp: string, incoming: string): Promise<boolean> {
    try {
        return (await generateSmileSignature(timestamp)) === incoming;
    } catch {
        return false;
    }
}

export interface SmileSessionToken {
    token: string;
    partner_id: string;
    environment: "sandbox" | "production";
}

// Calls the Smile ID Token API to create a web-SDK session for one user.
// The returned token is safe to pass to the browser — it does not contain the API key.
// product = "biometric_kyc" requires selfie + government ID document.
export async function generateSmileWebToken(params: {
    userPhone: string;
    callbackUrl: string;
    jobType?: 1 | 6; // 1 = Biometric KYC (selfie + ID), 6 = Document only
}): Promise<SmileSessionToken> {
    if (!PARTNER_ID || !API_KEY) {
        throw new Error("Missing SMILE_ID_PARTNER_ID or SMILE_ID_API_KEY in Supabase secrets.");
    }

    const timestamp = new Date().toISOString();
    const signature = await generateSmileSignature(timestamp);
    const jobId     = `clairtus-${params.userPhone}-${Date.now()}`;
    const jobType   = params.jobType ?? 1;
    const product   = jobType === 1 ? "biometric_kyc" : "document_verification";

    const body = {
        partner_id:     PARTNER_ID,
        timestamp,
        signature,
        user_id:        params.userPhone,
        job_id:         jobId,
        job_type:       jobType,
        product,
        callback_url:   params.callbackUrl,
        country:        "CD",                 // Democratic Republic of Congo
        id_type:        "VOTER_ID",           // Carte d'électeur (most common in DRC)
        language:       "fr",
    };

    const res = await fetch(`${BASE_URL}/v1/token`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.token) {
        console.error("[SmileID] Token generation failed:", JSON.stringify(data));
        throw new Error(`Smile ID token error: ${data.error ?? res.status}`);
    }

    console.log(`[SmileID] Session token generated for +${params.userPhone} (${SANDBOX ? "SANDBOX" : "PRODUCTION"})`);

    return {
        token:       data.token,
        partner_id:  PARTNER_ID,
        environment: SANDBOX ? "sandbox" : "production",
    };
}

// Result codes documented at https://docs.usesmileid.com/further-reading/result-codes
const APPROVED_CODES = new Set(["0810", "0811", "0812"]);

export function resultCodeToStatus(code: string): "VERIFIED" | "REJECTED" {
    return APPROVED_CODES.has(code) ? "VERIFIED" : "REJECTED";
}
