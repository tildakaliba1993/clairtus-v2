// supabase/functions/fx-rate-updater/index.ts
// Fetches the live USD→CDF exchange rate and caches it in the `fx_rates` table.
// Invoked by a daily cron. The hot transaction path never calls an FX API directly —
// it only reads the cached value written here, so transactions stay fast and resilient.
//
// Source is configurable via FX_RATE_API_URL (must return JSON with a USD base and a
// `rates.CDF` field). Default: open.er-api.com (free, no key, includes CDF).
// To use the BCC official reference rate instead, point FX_RATE_API_URL at a feed that
// exposes the same shape, or adapt the parser below.

import { getSupabaseClient } from "../_shared/supabaseClient.ts";

const DEFAULT_API = "https://open.er-api.com/v6/latest/USD";

// Plausibility band — rejects garbage/misconfigured responses (CDF/USD ~2,000–4,000 in 2024-26,
// but kept wide to tolerate sharp swings without blocking legitimate updates).
const MIN_PLAUSIBLE = 500;
const MAX_PLAUSIBLE = 100000;

Deno.serve(async (req: Request) => {
    // Allow GET (manual/cron ping) and POST.
    try {
        const apiUrl = Deno.env.get("FX_RATE_API_URL") ?? DEFAULT_API;
        const res = await fetch(apiUrl);
        const data = await res.json().catch(() => ({}));

        // Support both open.er-api.com ({rates:{CDF}}) and exchangerate.host-style shapes.
        const rate = Number(data?.rates?.CDF ?? data?.conversion_rates?.CDF ?? data?.data?.CDF);

        if (!rate || isNaN(rate) || rate < MIN_PLAUSIBLE || rate > MAX_PLAUSIBLE) {
            console.error(`[fx-rate-updater] Implausible/missing CDF rate: ${rate}. Response:`, JSON.stringify(data).slice(0, 300));
            return new Response(JSON.stringify({ ok: false, error: "Implausible or missing rate", rate }), {
                status: 502, headers: { "Content-Type": "application/json" },
            });
        }

        const supabase = getSupabaseClient();
        const { error } = await supabase.from("fx_rates").upsert({
            id: 1,
            usd_cdf: rate,
            source: apiUrl,
            updated_at: new Date().toISOString(),
        }, { onConflict: "id" });

        if (error) {
            console.error("[fx-rate-updater] DB upsert failed:", error);
            return new Response(JSON.stringify({ ok: false, error: error.message }), {
                status: 500, headers: { "Content-Type": "application/json" },
            });
        }

        console.log(`[fx-rate-updater] USD/CDF updated to ${rate} (source: ${apiUrl})`);
        return new Response(JSON.stringify({ ok: true, usd_cdf: rate }), {
            status: 200, headers: { "Content-Type": "application/json" },
        });
    } catch (e) {
        console.error("[fx-rate-updater] Unhandled error:", e);
        return new Response(JSON.stringify({ ok: false, error: String(e) }), {
            status: 500, headers: { "Content-Type": "application/json" },
        });
    }
});
