// supabase/functions/_shared/pawapayClient.ts
import { getSupabaseClient } from "./supabaseClient.ts";

const PAWAPAY_JWT = Deno.env.get("PAWAPAY_JWT") || ""; 

const isSandbox = PAWAPAY_JWT.toLowerCase().includes("sandbox") || PAWAPAY_JWT.startsWith("test");
const PAWAPAY_BASE_URL = isSandbox ? "https://api.sandbox.pawapay.io" : "https://api.pawapay.io";

const SUPABASE_WEBHOOK_URL = "https://ykzctgurmppikuesgvwt.supabase.co/functions/v1/pawapay-webhook";

export function getProviderByNetwork(network: string): string {
    const upperNetwork = network.toUpperCase();
    if (upperNetwork.includes("AIRTEL")) return "AIRTEL_COD";
    if (upperNetwork.includes("VODACOM") || upperNetwork.includes("MPESA")) return "VODACOM_MPESA_COD";
    if (upperNetwork.includes("ORANGE")) return "ORANGE_COD";
    return "VODACOM_MPESA_COD"; // Fallback
}

export function formatAmount(network: string, currency: string, amount: number): string {
    const upperNetwork = network.toUpperCase();
    const upperCurrency = currency.toUpperCase();

    if ((upperNetwork.includes("VODACOM") || upperNetwork.includes("MPESA")) && upperCurrency === "CDF") {
        return Math.round(amount).toString(); 
    }
    
    return amount.toFixed(2);
}

export async function initiatePawaPayDeposit(depositId: string, phone: string, amount: number, currency: string = "USD") {
    let network = "VODACOM";
    if (phone.startsWith("24397") || phone.startsWith("24399")) network = "AIRTEL";
    if (phone.startsWith("24384") || phone.startsWith("24385") || phone.startsWith("24389")) network = "ORANGE";

    const provider = getProviderByNetwork(network);
    const formattedAmount = formatAmount(network, currency, amount);

    console.log(`[PawaPay] Sending DEPOSIT Request to ${PAWAPAY_BASE_URL}/v1/deposits for ${phone} via ${provider}. Amount: ${formattedAmount} ${currency}`);

    const response = await fetch(`${PAWAPAY_BASE_URL}/v1/deposits`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${PAWAPAY_JWT}`
        },
        body: JSON.stringify({
            depositId: depositId,
            amount: formattedAmount,
            currency: currency.toUpperCase(),
            country: "COD",
            correspondent: provider,
            payer: {
                type: "MSISDN",
                address: {
                    value: phone
                }
            },
            customerTimestamp: new Date().toISOString(),
            statementDescription: "Clairtus Escrow",
            returnUrl: SUPABASE_WEBHOOK_URL
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`Deposit Error: ${errorText}`);
        throw new Error(`PawaPay Rejected Deposit: ${errorText}`);
    }

    return await response.json();
}

export async function initiatePawaPayPayout(payoutId: string, phone: string, amount: number, currency: string = "USD") {
    let network = "VODACOM";
    if (phone.startsWith("24397") || phone.startsWith("24399")) network = "AIRTEL";
    if (phone.startsWith("24384") || phone.startsWith("24385") || phone.startsWith("24389")) network = "ORANGE";

    const provider = getProviderByNetwork(network);
    const formattedAmount = formatAmount(network, currency, amount);

    console.log(`[PawaPay] Sending PAYOUT Request to ${PAWAPAY_BASE_URL}/v1/payouts for ${phone} via ${provider}. Amount: ${formattedAmount} ${currency}`);

    const response = await fetch(`${PAWAPAY_BASE_URL}/v1/payouts`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${PAWAPAY_JWT}`
        },
        body: JSON.stringify({
            payoutId: payoutId,
            amount: formattedAmount,
            currency: currency.toUpperCase(),
            country: "COD",
            correspondent: provider,
            recipient: {
                type: "MSISDN",
                address: {
                    value: phone
                }
            },
            // 🔧 THE FIX: Added the missing timestamp to the Payout request
            customerTimestamp: new Date().toISOString(),
            statementDescription: "Clairtus Payout",
            returnUrl: SUPABASE_WEBHOOK_URL
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`Payout Error: ${errorText}`);
        throw new Error(`PawaPay Rejected Payout: ${errorText}`);
    }

    return await response.json();
}