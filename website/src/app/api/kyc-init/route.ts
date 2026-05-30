// website/src/app/api/kyc-init/route.ts
// Server-side only. Generates a Smile ID web-SDK session token for a given user.
// The Smile ID API key is read from server-side env vars and NEVER sent to the browser.
// The client receives only the opaque session token (safe to expose).

import { NextRequest, NextResponse } from "next/server";

const PARTNER_ID   = process.env.SMILE_ID_PARTNER_ID ?? "";
const API_KEY      = process.env.SMILE_ID_API_KEY ?? "";
const SANDBOX      = process.env.SMILE_ID_SANDBOX !== "false";
const BASE_URL     = SANDBOX
    ? "https://testapi.smileidentity.com"
    : "https://api.smileidentity.com";
const CALLBACK_URL = process.env.SMILE_ID_CALLBACK_URL ?? "";

async function generateSignature(timestamp: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(API_KEY),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const raw = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}${PARTNER_ID}sid_request`));
    return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

export async function GET(request: NextRequest) {
    const phone = request.nextUrl.searchParams.get("phone");

    if (!phone || !/^\d{10,15}$/.test(phone)) {
        return NextResponse.json({ error: "Numéro de téléphone invalide." }, { status: 400 });
    }

    if (!PARTNER_ID || !API_KEY) {
        console.error("[KYC Init] Missing SMILE_ID_PARTNER_ID or SMILE_ID_API_KEY env vars.");
        return NextResponse.json({ error: "Configuration serveur manquante." }, { status: 500 });
    }

    try {
        const timestamp = new Date().toISOString();
        const signature = await generateSignature(timestamp);
        const jobId     = `clairtus-${phone}-${Date.now()}`;

        const res = await fetch(`${BASE_URL}/v1/token`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                partner_id:   PARTNER_ID,
                timestamp,
                signature,
                user_id:      phone,
                job_id:       jobId,
                job_type:     1,            // Biometric KYC: selfie + ID document
                product:      "biometric_kyc",
                callback_url: CALLBACK_URL,
                country:      "CD",         // DRC
                id_type:      "VOTER_ID",   // Carte d'électeur nationale
                language:     "fr",
            }),
        });

        const data = await res.json();

        if (!res.ok || !data.token) {
            console.error("[KYC Init] Smile ID token error:", data);
            return NextResponse.json({ error: "Impossible de démarrer la vérification. Réessayez." }, { status: 502 });
        }

        return NextResponse.json({
            token:       data.token,
            partner_id:  PARTNER_ID,
            environment: SANDBOX ? "sandbox" : "production",
            job_id:      jobId,
        });
    } catch (err) {
        console.error("[KYC Init] Server error:", err);
        return NextResponse.json({ error: "Erreur serveur inattendue." }, { status: 500 });
    }
}
