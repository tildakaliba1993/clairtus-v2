// supabase/functions/_shared/stateMachine.ts
import { sendWhatsAppText, sendWhatsAppButtons, sendWhatsAppTemplate, sendWhatsAppImage } from "./whatsappClient.ts";
import { getSupabaseClient } from "./supabaseClient.ts";
import { MESSAGES } from "./whatsappMessaging.ts";
import { initiatePawaPayPayout, initiatePawaPayDeposit } from "./pawapayClient.ts";
import { notifyAdmin } from "./adminAlerts.ts";

const TC_MESSAGE = "📜 *Conditions d'utilisation - Clairtus*\n\n1️⃣ L'argent de l'acheteur est strictement bloqué jusqu'à livraison (code PIN).\n2️⃣ Clairtus prélève 1.5% de frais d'escrow, répartis selon l'accord entre les parties.\n3️⃣ En cas de litige, les fonds sont gelés jusqu'à arbitrage.\n\n🔗 *Conditions & Confidentialité :* https://clairtus.com\n\nEn continuant, vous acceptez ces conditions.";

// Builds the personalized Smile ID verification URL for a user.
function buildKYCLink(phone: string): string {
    const base = Deno.env.get("KYC_BASE_URL") ?? "https://clairtus.com";
    return `${base}/kyc?phone=${encodeURIComponent(phone)}`;
}

// Sends the Smile ID verification link to a user via WhatsApp and parks them in AWAITING_KYC_COMPLETION.
// All KYC triggers in the state machine call this helper instead of showing a photo prompt.
async function sendKYCVerificationLink(phone: string, supabase: any, reason: string): Promise<void> {
    const link = buildKYCLink(phone);
    await supabase.from("sessions").update({ current_state: "AWAITING_KYC_COMPLETION" }).eq("phone_number", phone);
    await supabase.from("users").update({ kyc_status: "PENDING" }).eq("phone_number", phone);

    const msg = `🔐 *Vérification d'Identité Requise*\n\n` +
        `${reason}\n\n` +
        `👉 *Cliquez sur ce lien pour vérifier votre identité (2 min) :*\n${link}\n\n` +
        `📄 Documents acceptés : *Carte d'Électeur Nationale* ou *Passeport*\n` +
        `📱 Une caméra frontale et un bon éclairage sont nécessaires.\n\n` +
        `✅ Vous recevrez une notification WhatsApp dès que votre identité sera confirmée.`;

    await sendWhatsAppText(phone, msg);
}

// ─── BCC (Banque Centrale du Congo) regulatory limits ───────────────────────────
// Source: Instruction n°24 (2011), Article 17 — the PERMANENT law. The higher COVID
// figures in Instruction n°43 (USD 7,500 / 2,500 daily) expired end of Dec 2020 (Art. 11).
//   • Per-day payments  ≤ USD 500   • Per-month payments ≤ USD 2,500   • Wallet ≤ USD 3,000
// These ceilings apply to the PAYER (the e-money "porteur"). In Clairtus that is the
// BUYER, whose deposit is an outgoing e-money payment. Sellers/secondary vendors only
// RECEIVE funds; the USD 3,000 wallet-balance cap that governs receivers is enforced
// upstream by the MNO/PawaPay (we cannot observe a wallet balance), and any single
// payout here is < 500, far below 3,000.
//
// Raisable ONLY by express BCC authorization. If you obtain it, override via env:
//   BCC_MAX_USD (per-transaction & daily) / BCC_MONTHLY_MAX_USD (monthly).
const USD_RATE_CDF = 2830; // 1 USD ≈ 2,830 CDF (matches 500 USD = 1,415,000 CDF)

const MIN_AMOUNT: Record<string, number> = { USD: 1, CDF: USD_RATE_CDF };

function getBccDailyMaxUsd(): number {
    const n = parseFloat(Deno.env.get("BCC_MAX_USD") ?? "");
    return isNaN(n) ? 500 : n;
}
function getBccMonthlyMaxUsd(): number {
    const n = parseFloat(Deno.env.get("BCC_MONTHLY_MAX_USD") ?? "");
    return isNaN(n) ? 2500 : n;
}
function toUsd(amount: number, currency: string): number {
    return currency === "CDF" ? amount / USD_RATE_CDF : amount;
}
function fromUsd(amountUsd: number, currency: string): number {
    return currency === "CDF" ? Math.floor(amountUsd * USD_RATE_CDF) : parseFloat(amountUsd.toFixed(2));
}

// Per-transaction bounds: minimum floor + BCC daily ceiling (a single payment cannot
// exceed the daily cap). Returns a localized error message, or null if valid.
function checkAmountBounds(amount: number, currency: string): string | null {
    const min = MIN_AMOUNT[currency] ?? 1;
    if (amount < min) return MESSAGES.AMOUNT_TOO_LOW(min, currency);

    const maxInCurrency = fromUsd(getBccDailyMaxUsd(), currency);
    if (amount > maxInCurrency) return MESSAGES.AMOUNT_TOO_HIGH(maxInCurrency, currency);

    return null;
}

// Sums a buyer's committed payment volume (USD-equivalent) since `sinceIso`, excluding the
// in-flight transaction itself. Counts every status where the buyer's payment is committed
// or in-flight, so concurrent setups cannot collectively breach the ceiling.
async function sumBuyerVolumeUsd(supabase: any, buyerPhone: string, sinceIso: string, excludeTxId: string | null): Promise<number> {
    const { data } = await supabase.from("transactions")
        .select("id, base_amount, currency, applied_fee_percentage, fee_responsibility, status, created_at")
        .eq("buyer_phone", buyerPhone)
        .gte("created_at", sinceIso)
        .in("status", ["PENDING_FUNDING", "FUNDED", "PROCESSING_PAYOUTS", "PARTIAL_PAYOUT", "COMPLETED", "PAYOUT_FAILED"]);
    if (!data) return 0;
    let sumUsd = 0;
    for (const t of data) {
        if (excludeTxId && t.id === excludeTxId) continue;
        const dep = getDepositAmount(t.base_amount, t.applied_fee_percentage ?? 1.5, t.fee_responsibility);
        sumUsd += toUsd(dep, t.currency);
    }
    return sumUsd;
}

// Enforces the BCC daily (24h) and monthly (30d) PAYMENT ceilings against the BUYER.
// Returns a graceful French block message, or null if the deposit is within limits.
async function checkBuyerBccLimits(supabase: any, buyerPhone: string, depositAmount: number, currency: string, currentTxId: string | null): Promise<string | null> {
    const newUsd   = toUsd(depositAmount, currency);
    const now      = Date.now();
    const dayAgo   = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

    const dailyUsd = await sumBuyerVolumeUsd(supabase, buyerPhone, dayAgo, currentTxId);
    if (dailyUsd + newUsd > getBccDailyMaxUsd() + 0.01) {
        const remaining = fromUsd(Math.max(0, getBccDailyMaxUsd() - dailyUsd), currency);
        return MESSAGES.BCC_DAILY_LIMIT(remaining, currency);
    }

    const monthlyUsd = await sumBuyerVolumeUsd(supabase, buyerPhone, monthAgo, currentTxId);
    if (monthlyUsd + newUsd > getBccMonthlyMaxUsd() + 0.01) {
        const remaining = fromUsd(Math.max(0, getBccMonthlyMaxUsd() - monthlyUsd), currency);
        return MESSAGES.BCC_MONTHLY_LIMIT(remaining, currency);
    }

    return null;
}

// Computes the actual deposit amount the buyer pays based on who covers the escrow fee.
export function getDepositAmount(base: number, feePct: number, feeResp?: string | null): number {
    const fee = base * feePct / 100;
    if (feeResp === 'BUYER') return parseFloat((base + fee).toFixed(2));
    if (feeResp === 'SPLIT') return parseFloat((base + fee / 2).toFixed(2));
    return base; // SELLER (default)
}

// Builds the fee responsibility choice message shown to the transaction initiator.
// feePct must be > 0 — callers should skip this screen entirely when feePct === 0.
function buildFeeChoiceMessage(base: number, currency: string, isSellerInitiating: boolean, feePct: number): string {
    const fee = parseFloat((base * feePct / 100).toFixed(2));
    const buyerTotal = parseFloat((base + fee).toFixed(2));
    const sellerNet = parseFloat((base - fee).toFixed(2));
    const halfFee = parseFloat((fee / 2).toFixed(2));
    const buyerHalfTotal = parseFloat((base + halfFee).toFixed(2));
    const sellerHalfNet = parseFloat((base - halfFee).toFixed(2));

    const header = `💡 *Frais d'escrow Clairtus : ${feePct}% = ${fee} ${currency}*\n\nQui prend en charge ces frais ?\n\n`;
    if (isSellerInitiating) {
        return header +
            `• *Vendeur (moi)* → Je reçois *${sellerNet} ${currency}* net\n` +
            `• *L'Acheteur* → Il paie *${buyerTotal} ${currency}* au total\n` +
            `• *50/50* → Je reçois *${sellerHalfNet} ${currency}*, il paie *${buyerHalfTotal} ${currency}*`;
    }
    return header +
        `• *Acheteur (moi)* → Je paie *${buyerTotal} ${currency}* au total\n` +
        `• *Le Vendeur* → Il reçoit *${sellerNet} ${currency}* net\n` +
        `• *50/50* → Je paie *${buyerHalfTotal} ${currency}*, il reçoit *${sellerHalfNet} ${currency}* net`;
}

// 🔧 STRICT MNO IDENTIFIER 
export function getNetworkInfo(phone: string) {
    const clean = phone.replace(/\+/g, '').replace(/\s/g, '');
    if (clean.startsWith("24384") || clean.startsWith("24385") || clean.startsWith("24389") || clean.startsWith("24380")) {
        return { current: "Orange Money", alternative: "Vodacom M-Pesa" };
    }
    return { current: "Vodacom M-Pesa", alternative: "Orange Money" };
}

export async function processMessage(phone: string, text: string) {
    const supabase = getSupabaseClient();
    const cleanText = text.trim().replace(/^\//, '');

    console.log(`\n--- 🚀 NEW MESSAGE START ---`);
    console.log(`[State Machine] Processing message from ${phone}: "${cleanText}"`);

    try {
        let { data: user } = await supabase.from("users").select("*").eq("phone_number", phone).single();
        let { data: session } = await supabase.from("sessions").select("*").eq("phone_number", phone).single();

        if (!user || !session) {
            await supabase.from("users").upsert({ phone_number: phone, kyc_status: "UNVERIFIED" }, { onConflict: 'phone_number' });
            await supabase.from("sessions").upsert({ phone_number: phone, current_state: "AWAITING_TC" }, { onConflict: 'phone_number' });
            
            await sendWhatsAppButtons(phone, TC_MESSAGE, [
                { id: "CMD_ACCEPTER_TC", title: "✅ J'ACCEPTE" },
                { id: "CMD_REFUSER_TC", title: "❌ JE REFUSE" }
            ]);
            return;
        }

        if (user.kyc_level === "BANNED") return;

        // 👑 MVP GOD MODE 2.0: Two-Way Support Tunnels
        if (phone === "27603960790") {
            if (cleanText.toLowerCase().startsWith("chat ")) {
                const targetPhone = cleanText.split(" ")[1];
                if (targetPhone) {
                    await supabase.from("sessions").update({ current_state: `SUPPORT_CHAT_${targetPhone}` }).eq("phone_number", phone);
                    return await sendWhatsAppText(phone, `🟢 Mode Support activé avec ${targetPhone}.\nTout ce que vous tapez sera envoyé à l'utilisateur.\nTapez *fin* pour quitter.`);
                }
            }
            if (cleanText.toLowerCase() === "fin" || cleanText.toLowerCase() === "quitter") {
                if (session.current_state.startsWith("SUPPORT_CHAT_")) {
                    const targetPhone = session.current_state.replace("SUPPORT_CHAT_", "");
                    
                    // 1. Notify and reset Admin
                    await supabase.from("sessions").update({ current_state: "MAIN_MENU" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, `🔴 Mode Support désactivé. Conversation avec ${targetPhone} clôturée.`);
                    
                    // 2. Notify and reset User
                    await supabase.from("sessions").update({ current_state: "MAIN_MENU" }).eq("phone_number", targetPhone);
                    return await sendWhatsAppText(targetPhone, `✅ L'agent a clôturé cette session de support. Vous êtes de retour au menu principal.`);
                } else {
                    await supabase.from("sessions").update({ current_state: "MAIN_MENU" }).eq("phone_number", phone);
                    return await sendWhatsAppText(phone, `🔴 Mode Support désactivé.`);
                }
            }
            if (session.current_state.startsWith("SUPPORT_CHAT_")) {
                // If you are in chat mode, forward everything you type to the user
                const targetPhone = session.current_state.replace("SUPPORT_CHAT_", "");
                await sendWhatsAppText(targetPhone, `👨‍💻 *Support Clairtus* :\n\n${text}`);
                return; // 🛑 Stop processing so you don't trigger the rest of the bot logic!
            }
        }

        // 🚨 GLOBAL COMMAND TRAPS
        const isCancelCommand = ["ANNULER", "CMD_ANNULER", "REFUSER", "CMD_REFUSER"].includes(cleanText.toUpperCase());
        const isPinRecoveryCommand = ["CODE", "PIN", "RECUPERER", "RÉCUPÉRER"].includes(cleanText.toUpperCase());
        const isHelpCommand = ["AIDE", "CMD_AIDE", "HELP"].includes(cleanText.toUpperCase()); 
        const isRegistrationState = ["AWAITING_TC", "AWAITING_FIRST_NAME", "AWAITING_LAST_NAME", "AWAITING_PROMO_CODE"].includes(session.current_state);
        const isMenuCommand = ["BONJOUR", "MENU"].includes(cleanText.toUpperCase());

        if (isHelpCommand && !isRegistrationState) {
            console.log(`[Global Help] Triggered by ${phone} in state ${session.current_state}`);
            // Park the user in Support Mode
            await supabase.from("sessions").update({ current_state: "SUPPORT_MODE" }).eq("phone_number", phone);
            session.current_state = "SUPPORT_MODE"; // Update local state immediately
            
            await sendWhatsAppText(phone, "🎧 *Support Clairtus*\n\nVous êtes en communication avec un agent. Expliquez votre problème ci-dessous.\n\nTapez *MENU* à tout moment pour quitter le support et reprendre votre transaction.");
            await notifyAdmin("HELP_NEEDED", `Un utilisateur demande de l'aide.\nTapez:\nchat ${phone}\npour lui parler en direct.`, phone, session.draft_transaction_id);
            return; 
        }

        if (isPinRecoveryCommand && !isRegistrationState) {
            const { data: activePinTx } = await supabase.from("transactions")
                .select("*")
                .eq('buyer_phone', phone)
                .eq('status', 'FUNDED')
                .order('created_at', { ascending: false })
                .limit(1).single();

            if (activePinTx) {
                console.log(`[PIN Recovery] Sent code to buyer ${phone} for TX ${activePinTx.reference}`);
                return await sendWhatsAppText(phone, `🔑 *Rappel de votre Code PIN*\n\nPour la transaction *${activePinTx.item_description}*.\n\nVotre code PIN est : *${activePinTx.pin_code}*\n\nNe donnez ce code au vendeur *qu'après* avoir reçu et vérifié votre marchandise.`);
            }
        }

        if (isCancelCommand && !isRegistrationState) {
            console.log(`[Global Cancel] Triggered by ${phone}`);
            
            let txToCancel = null;
            if (session.draft_transaction_id) {
                const { data } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
                txToCancel = data;
            }
            if (!txToCancel) {
                const { data } = await supabase.from("transactions")
                    .select("*")
                    .or(`seller_phone.eq.${phone},buyer_phone.eq.${phone}`)
                    .in('status', ['INITIATED', 'PENDING_FUNDING', 'FUNDED', 'PAYOUT_FAILED'])
                    .order('created_at', { ascending: false })
                    .limit(1).single();
                txToCancel = data;
            }

            if (txToCancel) {
                if (txToCancel.status === "FUNDED") {
                    if (phone === txToCancel.seller_phone) {
                        await sendWhatsAppText(phone, "⏳ Annulation confirmée. Le remboursement de l'acheteur est en cours de traitement...");
                        try {
                            const refundId = crypto.randomUUID();
                            const cancelRefundAmt = getDepositAmount(txToCancel.base_amount, txToCancel.applied_fee_percentage ?? 1.5, txToCancel.fee_responsibility);
                            await initiatePawaPayPayout(refundId, txToCancel.buyer_phone, cancelRefundAmt, txToCancel.currency);
                            await supabase.from("transactions").update({ status: "REFUNDED", pawapay_refund_id: refundId }).eq("id", txToCancel.id);
                            await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
                            await sendWhatsAppText(phone, "☑️ Le contrat a été annulé et les fonds ont été retournés à l'acheteur.");
                            await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", txToCancel.buyer_phone);
                            await sendWhatsAppText(txToCancel.buyer_phone, "🚫 Le vendeur a annulé la transaction. Vos fonds vous ont été remboursés sur votre compte Mobile Money.");
                        } catch (error) {
                            console.error("Refund Error:", error);
                            await sendWhatsAppText(phone, "❌ Erreur technique lors du remboursement. Veuillez contacter le support.");
                        }
                        return;
                    } else if (phone === txToCancel.buyer_phone) {
                        await supabase.from("transactions").update({ status: "CANCELLATION_REQUESTED" }).eq("id", txToCancel.id);
                        await sendWhatsAppText(phone, "⏳ Votre demande d'annulation a été envoyée au vendeur. Les fonds restent sécurisés jusqu'à son approbation.");
                        
                        await supabase.from("sessions").update({ 
                            current_state: "AWAITING_CANCELLATION_APPROVAL", 
                            draft_transaction_id: txToCancel.id 
                        }).eq("phone_number", txToCancel.seller_phone);

                        await sendWhatsAppButtons(txToCancel.seller_phone, `🚨 L'acheteur demande l'annulation de la transaction ${txToCancel.reference}.\n\nAcceptez-vous d'annuler et de rembourser l'acheteur ?`, [
                            { id: "CMD_ACCEPTER_ANNULATION", title: "✅ REMBOURSER" },
                            { id: "CMD_LITIGE", title: "❌ LITIGE" }
                        ]);
                        return;
                    }
                }

                await supabase.from("transactions").update({ status: "CANCELLED" }).eq("id", txToCancel.id);
                const counterpartyPhone = (txToCancel.seller_phone === phone) ? txToCancel.buyer_phone : txToCancel.seller_phone;
                if (counterpartyPhone && counterpartyPhone !== phone) {
                    await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", counterpartyPhone);
                    await sendWhatsAppText(counterpartyPhone, "🚫 L'autre partie a annulé la transaction. Le dossier est clos.");
                }
            }

            await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
            await sendWhatsAppText(phone, "☑️ Action annulée avec succès. Tapez BONJOUR pour revenir au menu.");
            return;
        }

        // 🚀 UX FIX: Global escape hatch to Main Menu
        if (isMenuCommand && !isRegistrationState && session.current_state !== "MAIN_MENU") {
            // SYNCHRONIZED EXIT: If user leaves support, tell the Admin!
            if (session.current_state === "SUPPORT_MODE") {
                const adminPhone = "27603960790";
                const { data: adminSession } = await supabase.from("sessions").select("current_state").eq("phone_number", adminPhone).single();
                
                // Only pull the Admin out of chat if they were actively talking to THIS user
                if (adminSession && adminSession.current_state === `SUPPORT_CHAT_${phone}`) {
                    await supabase.from("sessions").update({ current_state: "MAIN_MENU" }).eq("phone_number", adminPhone);
                    await sendWhatsAppText(adminPhone, `🔴 L'utilisateur +${phone} a tapé MENU pour quitter le support. Votre session de chat a été fermée automatiquement.`);
                } else {
                    // If Admin hadn't joined the chat yet, just let them know the user left the waiting room
                    await sendWhatsAppText(adminPhone, `🔴 L'utilisateur +${phone} a quitté la file d'attente du support.`);
                }
            }

            await supabase.from("sessions").update({ current_state: "MAIN_MENU" }).eq("phone_number", phone);
            session.current_state = "MAIN_MENU"; 
        }

        // 🚦 STATE ROUTING
        switch (session.current_state) {
            case "AWAITING_TC":
                if (cleanText === "CMD_ACCEPTER_TC" || cleanText.toUpperCase() === "J'ACCEPTE") {
                    await supabase.from("sessions").update({ current_state: "AWAITING_FIRST_NAME" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, MESSAGES.FIRST_NAME_REQUEST);
                } else {
                    await sendWhatsAppText(phone, "⚠️ Vous devez accepter les conditions pour utiliser Clairtus.");
                }
                break;

            case "AWAITING_FIRST_NAME":
                await supabase.from("users").update({ first_name: cleanText }).eq("phone_number", phone);
                await supabase.from("sessions").update({ current_state: "AWAITING_LAST_NAME" }).eq("phone_number", phone);
                await sendWhatsAppText(phone, MESSAGES.LAST_NAME_REQUEST);
                break;

            case "AWAITING_LAST_NAME":
                await supabase.from("users").update({ last_name: cleanText }).eq("phone_number", phone);
                const { data: userWithNames } = await supabase.from("users").select("*").eq("phone_number", phone).single();
                await supabase.from("sessions").update({ current_state: "AWAITING_PROMO_CODE" }).eq("phone_number", phone);
                await sendWhatsAppText(phone, MESSAGES.ASK_PROMO_CODE(userWithNames.first_name));
                break;

            case "AWAITING_PROMO_CODE":
                if (cleanText.toUpperCase() === "NON") {
                    await supabase.from("sessions").update({ current_state: "MAIN_MENU" }).eq("phone_number", phone);
                    const { data: updatedUser } = await supabase.from("users").select("*").eq("phone_number", phone).single();
                    await sendWhatsAppButtons(phone, MESSAGES.WELCOME_RETURNING(updatedUser.first_name, updatedUser.last_name), [
                        { id: "CMD_VENDRE", title: "📦 VENDRE" }, 
                        { id: "CMD_ACHETER", title: "🛒 ACHETER" },
                        { id: "CMD_TRANSACTIONS", title: "📜 HISTORIQUE" }
                    ]);
                } else {
                    const inputCode = cleanText.trim().toUpperCase();
                    const { data: promo } = await supabase.from("promo_codes")
                        .select("*")
                        .eq("code_name", inputCode)
                        .eq("is_active", true)
                        .gt("expires_at", new Date().toISOString())
                        .single();

                    if (promo) {
                        await supabase.from("users").update({ promo_code_applied: inputCode }).eq("phone_number", phone);
                        await supabase.from("sessions").update({ current_state: "MAIN_MENU" }).eq("phone_number", phone);
                        await sendWhatsAppText(phone, MESSAGES.PROMO_CODE_SUCCESS(inputCode, promo.fee_percentage));
                    } else {
                        await sendWhatsAppText(phone, MESSAGES.PROMO_CODE_INVALID);
                    }
                }
                break;

                case "SUPPORT_MODE":
                // Route everything the user says directly to your Admin WhatsApp
                await sendWhatsAppText("27603960790", `📩 *De +${phone}* :\n\n${text}`);
                break;

                case "MAIN_MENU":
                if (cleanText.toUpperCase() === "BONJOUR" || cleanText.toLowerCase() === "menu") {
                    // 🚀 UX FIX: Added footer instruction for AIDE since Meta blocks 4+ buttons
                    const welcomeText = MESSAGES.WELCOME_RETURNING(user.first_name, user.last_name) + "\n\n💡 *Note :* Tapez *AIDE* à tout moment pour parler à un agent.";
                    
                    await sendWhatsAppButtons(phone, welcomeText, [
                        { id: "CMD_VENDRE", title: "📦 VENDRE" }, 
                        { id: "CMD_ACHETER", title: "🛒 ACHETER" },
                        { id: "CMD_TRANSACTIONS", title: "📜 HISTORIQUE" }
                    ]);
                } else if (cleanText === "CMD_VENDRE" || cleanText.toUpperCase() === "VENDRE") {
                    const { data: staleTx } = await supabase
                        .from("transactions")
                        .select("id, reference, item_description")
                        .eq("seller_phone", phone)
                        .in("status", ["DRAFT", "INITIATED", "PENDING_FUNDING"])
                        .order('created_at', { ascending: false })
                        .limit(1).single();

                    if (staleTx) {
                        await supabase.from("sessions").update({ current_state: "CONFIRM_CANCEL_OLD_SELL", draft_transaction_id: staleTx.id }).eq("phone_number", phone);
                        return await sendWhatsAppButtons(phone, `⚠️ Vous avez déjà une transaction en cours :\n*${staleTx.item_description || staleTx.reference}*\n\nQue souhaitez-vous faire ?`, [
                            { id: "CMD_OUI_CANCEL_OLD", title: "🆕 NOUVELLE (Annuler)" },
                            { id: "CMD_NON_CANCEL_OLD", title: "🔄 REPRENDRE" }
                        ]);
                    }

                    await supabase.from("sessions").update({ current_state: "AWAITING_ITEM_DESCRIPTION_SELL" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, MESSAGES.SELL_ITEM_REQUEST);

                } else if (cleanText === "CMD_ACHETER" || cleanText.toUpperCase() === "ACHETER") {
                    const cleanPhoneCheck = phone.replace(/\+/g, '').replace(/\s/g, '');
                    if (cleanPhoneCheck.startsWith("24399") || cleanPhoneCheck.startsWith("24397")) {
                        return await sendWhatsAppText(phone, MESSAGES.AIRTEL_BUYER_BLOCKED);
                    }

                    const { data: staleTx } = await supabase
                        .from("transactions")
                        .select("id, reference, item_description")
                        .eq("buyer_phone", phone)
                        .in("status", ["DRAFT", "INITIATED", "PENDING_FUNDING"])
                        .order('created_at', { ascending: false })
                        .limit(1).single();

                    if (staleTx) {
                        await supabase.from("sessions").update({ current_state: "CONFIRM_CANCEL_OLD_BUY", draft_transaction_id: staleTx.id }).eq("phone_number", phone);
                        return await sendWhatsAppButtons(phone, `⚠️ Vous avez déjà une transaction en cours :\n*${staleTx.item_description || staleTx.reference}*\n\nQue souhaitez-vous faire ?`, [
                            { id: "CMD_OUI_CANCEL_OLD", title: "🆕 NOUVELLE (Annuler)" },
                            { id: "CMD_NON_CANCEL_OLD", title: "🔄 REPRENDRE" }
                        ]);
                    }

                    await supabase.from("sessions").update({ current_state: "AWAITING_ITEM_DESCRIPTION_BUY" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, MESSAGES.BUY_ITEM_REQUEST);

                } else if (cleanText === "CMD_TRANSACTIONS" || cleanText.toUpperCase() === "HISTORIQUE") {
                    const { data: txs, error } = await supabase.from("transactions").select("*")
                        .or(`seller_phone.eq.${phone},buyer_phone.eq.${phone}`)
                        .order('created_at', { ascending: false }).limit(5);
                    if (error || !txs || txs.length === 0) {
                        await sendWhatsAppText(phone, "📭 Vous n'avez aucune transaction récente.");
                    } else {
                        let txList = "📜 *Vos 5 dernières transactions:*\n\n";
                        
                        // 🚀 UX FIX: Translate Database Statuses to French
                        const statusMap: Record<string, string> = {
                            "DRAFT": "Brouillon",
                            "INITIATED": "En attente",
                            "PENDING_FUNDING": "Attente de paiement",
                            "FUNDED": "Fonds sécurisés 🔒",
                            "PROCESSING_PAYOUTS": "Envoi en cours ⏳",
                            "COMPLETED": "Terminée ✅",
                            "CANCELLED": "Annulée 🚫",
                            "CANCELLATION_REQUESTED": "Annulation demandée",
                            "DISPUTED": "En Litige 🚨",
                            "REFUNDED": "Remboursée 💸",
                            "PAYOUT_FAILED": "Échec transfert ❌"
                        };

                        txs.forEach((tx, index) => {
                            const role = tx.seller_phone === phone ? "Vendeur" : "Acheteur";
                            const amount = tx.base_amount ? `${tx.base_amount} ${tx.currency}` : "N/A";
                            const frenchStatus = statusMap[tx.status] || tx.status;
                            
                            txList += `*${index + 1}. ${tx.item_description || tx.reference}*\nRôle: ${role} | ${amount} | Statut: ${frenchStatus}\n\n`;
                        });
                        await sendWhatsAppText(phone, txList);
                    }
                } else {
                    await sendWhatsAppText(phone, MESSAGES.UNKNOWN_MESSAGE);
                }
                break;

            case "CONFIRM_CANCEL_OLD_SELL":
            case "CONFIRM_CANCEL_OLD_BUY": {
                const isSellFlow = session.current_state === "CONFIRM_CANCEL_OLD_SELL";

                if (cleanText === "CMD_OUI_CANCEL_OLD" || cleanText.toUpperCase() === "NOUVELLE" || cleanText.toUpperCase() === "ANNULER") {
                    await supabase.from("transactions").update({ status: "CANCELLED" }).eq("id", session.draft_transaction_id);
                    await supabase.from("sessions").update({ current_state: isSellFlow ? "AWAITING_ITEM_DESCRIPTION_SELL" : "AWAITING_ITEM_DESCRIPTION_BUY", draft_transaction_id: null }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, "✅ Ancienne transaction annulée.\n\n" + (isSellFlow ? MESSAGES.SELL_ITEM_REQUEST : MESSAGES.BUY_ITEM_REQUEST));
                } else {
                    // 🚀 UX FIX: Dynamic Resume Logic
                    const { data: tx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
                    
                    if (!tx) {
                        await supabase.from("sessions").update({ current_state: "MAIN_MENU" }).eq("phone_number", phone);
                        return await sendWhatsAppText(phone, "❌ Erreur: Transaction introuvable. Tapez BONJOUR pour revenir au menu.");
                    }

                    const isSeller = tx.seller_phone === phone;
                    const itemTitle = tx.item_description || tx.reference;

                    if (!tx.currency) {
                        await supabase.from("sessions").update({ current_state: isSeller ? "AWAITING_CURRENCY_SELL" : "AWAITING_CURRENCY_BUY" }).eq("phone_number", phone);
                        await sendWhatsAppButtons(phone, `🔄 *Reprise de la transaction :*\n${itemTitle}\n\n` + MESSAGES.CURRENCY_REQUEST, [{ id: "CMD_CURR_USD", title: "USD ($)" }, { id: "CMD_CURR_CDF", title: "CDF (Francs)" }]);
                    } else if (!tx.base_amount) {
                        await supabase.from("sessions").update({ current_state: isSeller ? "AWAITING_PRICE_SELL" : "AWAITING_PRICE_BUY" }).eq("phone_number", phone);
                        await sendWhatsAppText(phone, `🔄 *Reprise de la transaction :*\n${itemTitle}\n\n` + (isSeller ? MESSAGES.PRICE_REQUEST_SELL(itemTitle, tx.currency) : MESSAGES.PRICE_REQUEST_BUY(itemTitle, tx.currency)));
                    } else if (!tx.fee_responsibility) {
                        const resumeFeePct = tx.applied_fee_percentage ?? 1.5;
                        if (resumeFeePct === 0) {
                            // Promo already applied — save default and skip fee screen
                            await supabase.from("transactions").update({ fee_responsibility: 'SELLER' }).eq("id", tx.id);
                            if (isSeller) {
                                await supabase.from("sessions").update({ current_state: "AWAITING_SPLIT_CHOICE" }).eq("phone_number", phone);
                                await sendWhatsAppButtons(phone, `🎉 *Code promo actif !*\n\nAucuns frais d'escrow sur cette transaction.\n\n` + MESSAGES.ASK_SPLIT_CHOICE, [{ id: "CMD_OUI_SPLIT", title: "OUI" }, { id: "CMD_NON_SPLIT", title: "NON" }]);
                            } else {
                                await supabase.from("sessions").update({ current_state: "AWAITING_COUNTERPARTY_PHONE_BUY" }).eq("phone_number", phone);
                                await sendWhatsAppText(phone, `🎉 *Code promo actif ! Frais à 0%.*\n\n` + MESSAGES.COUNTERPARTY_PHONE_REQUEST_BUY(tx.base_amount, tx.currency));
                            }
                        } else {
                            const feeState = isSeller ? "AWAITING_FEE_RESPONSIBILITY_SELL" : "AWAITING_FEE_RESPONSIBILITY_BUY";
                            const feeBtns = isSeller
                                ? [{ id: "CMD_FEE_SELLER", title: "Vendeur (moi)" }, { id: "CMD_FEE_BUYER", title: "L'Acheteur" }, { id: "CMD_FEE_SPLIT", title: "50/50 Partager" }]
                                : [{ id: "CMD_FEE_BUYER", title: "Acheteur (moi)" }, { id: "CMD_FEE_SELLER", title: "Le Vendeur" }, { id: "CMD_FEE_SPLIT", title: "50/50 Partager" }];
                            await supabase.from("sessions").update({ current_state: feeState }).eq("phone_number", phone);
                            await sendWhatsAppButtons(phone, `🔄 *Reprise :* ${itemTitle}\n\n` + buildFeeChoiceMessage(tx.base_amount, tx.currency, isSeller, resumeFeePct), feeBtns);
                        }
                    } else if (isSeller && !tx.secondary_vendor_phone && !tx.buyer_phone && tx.status === "DRAFT") {
                        await supabase.from("sessions").update({ current_state: "AWAITING_SPLIT_CHOICE" }).eq("phone_number", phone);
                        await sendWhatsAppButtons(phone, `🔄 *Reprise de la transaction :*\n${itemTitle} (${tx.base_amount} ${tx.currency})\n\n` + MESSAGES.ASK_SPLIT_CHOICE, [
                            { id: "CMD_OUI_SPLIT", title: "OUI" },
                            { id: "CMD_NON_SPLIT", title: "NON" }
                        ]);
                    } else if (isSeller && !tx.buyer_phone) {
                        await supabase.from("sessions").update({ current_state: "AWAITING_COUNTERPARTY_PHONE_SELL" }).eq("phone_number", phone);
                        await sendWhatsAppText(phone, `🔄 *Reprise de la transaction :*\n${itemTitle} (${tx.base_amount} ${tx.currency})\n\n` + MESSAGES.COUNTERPARTY_PHONE_REQUEST_SELL(tx.base_amount, tx.currency) + "\n\n⚠️ *Veuillez utiliser un numéro M-Pesa ou Orange.*");
                    } else if (!isSeller && !tx.seller_phone) {
                        await supabase.from("sessions").update({ current_state: "AWAITING_COUNTERPARTY_PHONE_BUY" }).eq("phone_number", phone);
                        await sendWhatsAppText(phone, `🔄 *Reprise de la transaction :*\n${itemTitle} (${tx.base_amount} ${tx.currency})\n\n` + MESSAGES.COUNTERPARTY_PHONE_REQUEST_BUY(tx.base_amount, tx.currency));
                    } else if (tx.status === "INITIATED") {
                        await supabase.from("sessions").update({ current_state: isSeller ? "INITIATED_SELLER" : "INITIATED_BUYER" }).eq("phone_number", phone);
                        await sendWhatsAppText(phone, `🔄 La transaction *${itemTitle}* est en attente de l'autre partie.\n\n` + (isSeller ? MESSAGES.SELLER_WAITING_FOR_BUYER : MESSAGES.BUYER_WAITING_FOR_SELLER));
                    } else {
                        await supabase.from("sessions").update({ current_state: "MAIN_MENU" }).eq("phone_number", phone);
                        await sendWhatsAppText(phone, "✅ Cette transaction est déjà validée ou en cours de paiement. Tapez HISTORIQUE pour voir son statut.");
                    }
                }
                break;
            }

            case "CONFIRM_CANCEL_OLD":
                if (cleanText === "CMD_OUI_CANCEL_OLD" || cleanText.toUpperCase() === "OUI") {
                    await supabase.from("transactions").update({ status: "CANCELLED" }).eq("id", session.draft_transaction_id);
                    await supabase.from("sessions").update({ current_state: "AWAITING_ITEM_DESCRIPTION_SELL", draft_transaction_id: null }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, "✅ Ancienne transaction annulée.\n\n" + MESSAGES.SELL_ITEM_REQUEST);
                } else {
                    await supabase.from("sessions").update({ current_state: "MAIN_MENU" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, "Entendu. L'ancienne transaction reste active. Tapez BONJOUR pour revenir au menu.");
                }
                break;

            case "AWAITING_ITEM_DESCRIPTION_SELL": {
                const sellRef = "CLT-" + Math.random().toString(36).substring(2, 10).toUpperCase();
                
                let appliedFee = 1.5;
                if (user.promo_code_applied) {
                    const { data: promo } = await supabase.from("promo_codes")
                        .select("*")
                        .eq("code_name", user.promo_code_applied)
                        .eq("is_active", true)
                        .gt("expires_at", new Date().toISOString())
                        .single();
                    if (promo) appliedFee = promo.fee_percentage;
                }

                const { data: sellTx } = await supabase.from("transactions").insert({
                    reference: sellRef, seller_phone: phone, item_description: cleanText, status: "DRAFT", applied_fee_percentage: appliedFee
                }).select().single();
                
                await supabase.from("sessions").update({ current_state: "AWAITING_CURRENCY_SELL", draft_transaction_id: sellTx.id }).eq("phone_number", phone);
                await sendWhatsAppButtons(phone, MESSAGES.CURRENCY_REQUEST, [{ id: "CMD_CURR_USD", title: "USD ($)" }, { id: "CMD_CURR_CDF", title: "CDF (Francs)" }]);
                break;
            }

            case "AWAITING_ITEM_DESCRIPTION_BUY": {
                const buyRef = "CLT-" + Math.random().toString(36).substring(2, 10).toUpperCase();
                
                let appliedFee = 1.5;
                if (user.promo_code_applied) {
                    const { data: promo } = await supabase.from("promo_codes")
                        .select("*")
                        .eq("code_name", user.promo_code_applied)
                        .eq("is_active", true)
                        .gt("expires_at", new Date().toISOString())
                        .single();
                    if (promo) appliedFee = promo.fee_percentage;
                }

                const { data: buyTx } = await supabase.from("transactions").insert({
                    reference: buyRef, buyer_phone: phone, item_description: cleanText, status: "DRAFT", applied_fee_percentage: appliedFee
                }).select().single();
                
                await supabase.from("sessions").update({ current_state: "AWAITING_CURRENCY_BUY", draft_transaction_id: buyTx.id }).eq("phone_number", phone);
                await sendWhatsAppButtons(phone, MESSAGES.CURRENCY_REQUEST, [{ id: "CMD_CURR_USD", title: "USD ($)" }, { id: "CMD_CURR_CDF", title: "CDF (Francs)" }]);
                break;
            }

            case "AWAITING_CURRENCY_SELL": {
                if (cleanText === "CMD_CURR_USD" || cleanText === "CMD_CURR_CDF") {
                    const selectedCurrency = cleanText === "CMD_CURR_USD" ? "USD" : "CDF";
                    const { data: tx } = await supabase.from("transactions").update({ currency: selectedCurrency }).eq("id", session.draft_transaction_id).select().single();
                    await supabase.from("sessions").update({ current_state: "AWAITING_PRICE_SELL" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, MESSAGES.PRICE_REQUEST_SELL(tx.item_description, selectedCurrency));
                } else {
                    await sendWhatsAppText(phone, "⚠️ Veuillez utiliser les boutons pour sélectionner la devise.");
                }
                break;
            }

            case "AWAITING_CURRENCY_BUY": {
                if (cleanText === "CMD_CURR_USD" || cleanText === "CMD_CURR_CDF") {
                    const selectedCurrency = cleanText === "CMD_CURR_USD" ? "USD" : "CDF";
                    const { data: tx } = await supabase.from("transactions").update({ currency: selectedCurrency }).eq("id", session.draft_transaction_id).select().single();
                    await supabase.from("sessions").update({ current_state: "AWAITING_PRICE_BUY" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, MESSAGES.PRICE_REQUEST_BUY(tx.item_description, selectedCurrency));
                } else {
                    await sendWhatsAppText(phone, "⚠️ Veuillez utiliser les boutons pour sélectionner la devise.");
                }
                break;
            }

            // 🤝 FEE RESPONSIBILITY SELECTION
            case "AWAITING_FEE_RESPONSIBILITY_SELL":
            case "AWAITING_FEE_RESPONSIBILITY_BUY": {
                const isSellFeeState = session.current_state === "AWAITING_FEE_RESPONSIBILITY_SELL";
                let feeResp: string | null = null;
                if (cleanText === "CMD_FEE_SELLER") feeResp = "SELLER";
                else if (cleanText === "CMD_FEE_BUYER") feeResp = "BUYER";
                else if (cleanText === "CMD_FEE_SPLIT") feeResp = "SPLIT";

                if (!feeResp) {
                    return await sendWhatsAppText(phone, "⚠️ Veuillez utiliser les boutons pour choisir qui couvre les frais.");
                }

                await supabase.from("transactions").update({ fee_responsibility: feeResp }).eq("id", session.draft_transaction_id);

                if (isSellFeeState) {
                    await supabase.from("sessions").update({ current_state: "AWAITING_SPLIT_CHOICE" }).eq("phone_number", phone);
                    await sendWhatsAppButtons(phone, MESSAGES.ASK_SPLIT_CHOICE, [
                        { id: "CMD_OUI_SPLIT", title: "OUI" },
                        { id: "CMD_NON_SPLIT", title: "NON" }
                    ]);
                } else {
                    const { data: txFee } = await supabase.from("transactions").select("base_amount, currency").eq("id", session.draft_transaction_id).single();
                    await supabase.from("sessions").update({ current_state: "AWAITING_COUNTERPARTY_PHONE_BUY" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, MESSAGES.COUNTERPARTY_PHONE_REQUEST_BUY(txFee?.base_amount, txFee?.currency));
                }
                break;
            }

            // 🚀 SPLIT PAYOUT (VENDOR INITIATED FLOW)
            case "AWAITING_PRICE_SELL": {
                const priceSell = parseFloat(cleanText.replace(',', '.'));
                if (isNaN(priceSell) || priceSell <= 0) return await sendWhatsAppText(phone, MESSAGES.AMOUNT_INVALID_FORMAT);

                const { data: currentTx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();

                // 🏦 MIN FLOOR + BCC MAX CEILING (applies to all users)
                const boundsErrorSell = checkAmountBounds(priceSell, currentTx.currency);
                if (boundsErrorSell) return await sendWhatsAppText(phone, boundsErrorSell);

                // 🛡️ COMPLIANCE: KYC THRESHOLD (unverified users only)
                const limitAmount = currentTx.currency === "USD" ? 500 : 1415000;
                if (priceSell > limitAmount && user.kyc_status !== "VERIFIED") {
                    return await sendKYCVerificationLink(phone, supabase, `Votre compte n'est pas encore vérifié. La limite est de *${limitAmount} ${currentTx.currency}* par transaction non vérifiée.`);
                }

                await supabase.from("transactions").update({ base_amount: priceSell }).eq("id", session.draft_transaction_id);
                const feePctSell = currentTx.applied_fee_percentage ?? 1.5;
                if (feePctSell === 0) {
                    // Promo active — no fee to share, skip directly to split payout choice
                    await supabase.from("transactions").update({ fee_responsibility: 'SELLER' }).eq("id", session.draft_transaction_id);
                    await supabase.from("sessions").update({ current_state: "AWAITING_SPLIT_CHOICE" }).eq("phone_number", phone);
                    await sendWhatsAppButtons(phone, `🎉 *Code promo actif !*\n\nAucuns frais d'escrow ne seront prélevés sur cette transaction. Les deux parties en profitent !\n\n` + MESSAGES.ASK_SPLIT_CHOICE, [
                        { id: "CMD_OUI_SPLIT", title: "OUI" },
                        { id: "CMD_NON_SPLIT", title: "NON" }
                    ]);
                } else {
                    await supabase.from("sessions").update({ current_state: "AWAITING_FEE_RESPONSIBILITY_SELL" }).eq("phone_number", phone);
                    await sendWhatsAppButtons(phone, buildFeeChoiceMessage(priceSell, currentTx.currency, true, feePctSell), [
                        { id: "CMD_FEE_SELLER", title: "Vendeur (moi)" },
                        { id: "CMD_FEE_BUYER", title: "L'Acheteur" },
                        { id: "CMD_FEE_SPLIT", title: "50/50 Partager" }
                    ]);
                }
                break;
            }

            case "AWAITING_SPLIT_CHOICE": {
                const { data: txSell } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
                
                if (cleanText === "CMD_OUI_SPLIT" || cleanText.toUpperCase() === "OUI") {
                    await supabase.from("sessions").update({ current_state: "AWAITING_SECONDARY_PHONE" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, MESSAGES.ASK_SECONDARY_PHONE);
                } else if (cleanText === "CMD_NON_SPLIT" || cleanText.toUpperCase() === "NON") {
                    await supabase.from("sessions").update({ current_state: "AWAITING_COUNTERPARTY_PHONE_SELL" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, MESSAGES.COUNTERPARTY_PHONE_REQUEST_SELL(txSell.base_amount, txSell.currency) + "\n\n⚠️ *Veuillez utiliser un numéro M-Pesa ou Orange (Airtel indisponible pour les paiements).*");
                } else {
                     await sendWhatsAppText(phone, "⚠️ Veuillez utiliser les boutons OUI ou NON.");
                }
                break;
            }

            case "AWAITING_SECONDARY_PHONE": {
                let secPhone = cleanText.replace(/\+/g, '').replace(/\s/g, '');
                if (secPhone.startsWith("0") && secPhone.length === 10) secPhone = "243" + secPhone.substring(1);
                if (!/^\d{10,15}$/.test(secPhone)) return await sendWhatsAppText(phone, MESSAGES.PHONE_INVALID);
                if (secPhone === phone) return await sendWhatsAppText(phone, "🚫 Vous ne pouvez pas partager le paiement avec votre propre numéro.");

                await supabase.from("transactions").update({ secondary_vendor_phone: secPhone }).eq("id", session.draft_transaction_id);
                const { data: txForSplit } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
                
                await supabase.from("sessions").update({ current_state: "AWAITING_SECONDARY_AMOUNT" }).eq("phone_number", phone);
                await sendWhatsAppText(phone, MESSAGES.ASK_SECONDARY_AMOUNT(txForSplit.base_amount, txForSplit.currency));
                break;
            }

            case "AWAITING_SECONDARY_AMOUNT": {
                const secAmount = parseFloat(cleanText.replace(',', '.'));
                const { data: currentTx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();

                if (isNaN(secAmount) || secAmount <= 0) return await sendWhatsAppText(phone, MESSAGES.AMOUNT_INVALID_FORMAT);
                if (secAmount >= currentTx.base_amount) return await sendWhatsAppText(phone, MESSAGES.SPLIT_AMOUNT_ERROR);

                await supabase.from("transactions").update({ secondary_vendor_amount: secAmount }).eq("id", session.draft_transaction_id);
                await supabase.from("sessions").update({ current_state: "AWAITING_COUNTERPARTY_PHONE_SELL" }).eq("phone_number", phone);
                await sendWhatsAppText(phone, MESSAGES.COUNTERPARTY_PHONE_REQUEST_SELL(currentTx.base_amount, currentTx.currency) + "\n\n⚠️ *Veuillez utiliser un numéro M-Pesa ou Orange (Airtel indisponible pour les paiements).*");
                break;
            }

            case "AWAITING_PRICE_BUY": {
                const priceBuy = parseFloat(cleanText.replace(',', '.'));
                if (isNaN(priceBuy) || priceBuy <= 0) return await sendWhatsAppText(phone, MESSAGES.AMOUNT_INVALID_FORMAT);

                const { data: currentTx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();

                // 🏦 MIN FLOOR + BCC PER-TRANSACTION CEILING (applies to all users)
                const boundsErrorBuy = checkAmountBounds(priceBuy, currentTx.currency);
                if (boundsErrorBuy) return await sendWhatsAppText(phone, boundsErrorBuy);

                // 🏦 BCC daily/monthly check (early UX — in the BUY flow the buyer is the initiator,
                // so we can warn them now rather than after a counterparty accepts). The authoritative
                // check still runs in finalizeContractAndPromptPayment before any deposit.
                const buyEarlyBcc = await checkBuyerBccLimits(supabase, phone, priceBuy, currentTx.currency, session.draft_transaction_id);
                if (buyEarlyBcc) return await sendWhatsAppText(phone, buyEarlyBcc);

                // 🛡️ COMPLIANCE: KYC THRESHOLD — only reachable if a higher BCC authorization is
                // configured via env (otherwise the per-transaction cap above already blocks > daily max).
                const limitAmount = currentTx.currency === "USD" ? 500 : 1415000;
                if (priceBuy > limitAmount && user.kyc_status !== "VERIFIED") {
                    return await sendKYCVerificationLink(phone, supabase, `Votre compte n'est pas encore vérifié. La limite est de *${limitAmount} ${currentTx.currency}* par transaction non vérifiée.`);
                }

                await supabase.from("transactions").update({ base_amount: priceBuy }).eq("id", session.draft_transaction_id);
                const feePctBuy = currentTx.applied_fee_percentage ?? 1.5;
                if (feePctBuy === 0) {
                    // Promo active — skip fee responsibility screen
                    await supabase.from("transactions").update({ fee_responsibility: 'SELLER' }).eq("id", session.draft_transaction_id);
                    await supabase.from("sessions").update({ current_state: "AWAITING_COUNTERPARTY_PHONE_BUY" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, `🎉 *Code promo actif ! Frais à 0% sur cette transaction.*\n\n` + MESSAGES.COUNTERPARTY_PHONE_REQUEST_BUY(priceBuy, currentTx.currency));
                } else {
                    await supabase.from("sessions").update({ current_state: "AWAITING_FEE_RESPONSIBILITY_BUY" }).eq("phone_number", phone);
                    await sendWhatsAppButtons(phone, buildFeeChoiceMessage(priceBuy, currentTx.currency, false, feePctBuy), [
                        { id: "CMD_FEE_BUYER", title: "Acheteur (moi)" },
                        { id: "CMD_FEE_SELLER", title: "Le Vendeur" },
                        { id: "CMD_FEE_SPLIT", title: "50/50 Partager" }
                    ]);
                }
                break;
            }

            case "AWAITING_COUNTERPARTY_PHONE_SELL": {
                let counterpartyPhone = cleanText.replace(/\+/g, '').replace(/\s/g, '');
                if (counterpartyPhone.startsWith("0") && counterpartyPhone.length === 10) counterpartyPhone = "243" + counterpartyPhone.substring(1);
                if (!/^\d{10,15}$/.test(counterpartyPhone)) return await sendWhatsAppText(phone, MESSAGES.PHONE_INVALID);
                if (counterpartyPhone === phone) return await sendWhatsAppText(phone, MESSAGES.SELF_TRANSACTION_BLOCKED);
                
                if (counterpartyPhone.startsWith("24399") || counterpartyPhone.startsWith("24397")) {
                    return await sendWhatsAppText(phone, MESSAGES.AIRTEL_BUYER_BLOCKED);
                }

                // 🛡️ COMPLIANCE 1: CROSS-WALLET SELF-DEALING BLOCK
                let { data: cpUser } = await supabase.from("users").select("*").eq("phone_number", counterpartyPhone).single();
                if (cpUser && cpUser.first_name && cpUser.last_name && user.first_name && user.last_name) {
                    if (cpUser.first_name.toLowerCase() === user.first_name.toLowerCase() && cpUser.last_name.toLowerCase() === user.last_name.toLowerCase()) {
                        return await sendWhatsAppText(phone, "🚫 *Alerte de Sécurité* : Les transactions entre vos propres comptes (même identité) sont strictement interdites.");
                    }
                }

                // 🛡️ COMPLIANCE 2: PING-PONG INTERCEPTOR
                const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                const { count: pingPongCount } = await supabase.from("transactions")
                    .select("*", { count: "exact", head: true })
                    .or(`and(seller_phone.eq.${phone},buyer_phone.eq.${counterpartyPhone}),and(seller_phone.eq.${counterpartyPhone},buyer_phone.eq.${phone})`)
                    .gte("created_at", twentyFourHoursAgo);

                if (pingPongCount !== null && pingPongCount >= 2 && user.kyc_status !== "VERIFIED") {
                    return await sendKYCVerificationLink(phone, supabase, "Vous avez atteint la limite de transactions répétées avec ce numéro. Une vérification d'identité est requise pour continuer.");
                }

                const { data: txSell } = await supabase.from("transactions").update({ buyer_phone: counterpartyPhone, status: "INITIATED" }).eq("id", session.draft_transaction_id).select().single();
                await supabase.from("sessions").update({ current_state: "INITIATED_SELLER" }).eq("phone_number", phone);
                await sendWhatsAppText(phone, MESSAGES.SELLER_WAITING_FOR_BUYER);
                
                await supabase.from("users").upsert({ phone_number: counterpartyPhone }, { onConflict: 'phone_number' });
                await supabase.from("sessions").upsert({ phone_number: counterpartyPhone, current_state: "INVITED_BUYER", draft_transaction_id: session.draft_transaction_id }, { onConflict: 'phone_number' });
                
                const sellerScore = user.trust_score ?? 50;
                const feeBuyerDesc = MESSAGES.FEE_DESCRIPTION_FOR_BUYER(txSell.base_amount, txSell.currency, txSell.fee_responsibility || 'SELLER', txSell.applied_fee_percentage ?? 1.5);
                const inviteTextSell = `🛡️ *Indice de Confiance du Vendeur : ${sellerScore}/100*\n⭐ (Basé sur l'historique des transactions sur Clairtus)\n\n` +
                    MESSAGES.BUYER_INVITE_BUTTONS(phone, txSell.item_description) +
                    `\n\n${feeBuyerDesc}`;

                await sendWhatsAppButtons(counterpartyPhone, inviteTextSell, [
                    { id: "CMD_ACCEPTER", title: "ACCEPTER" }, { id: "CMD_REFUSER", title: "REFUSER" }, { id: "CMD_AIDE", title: "AIDE" }
                ]);
                break;
            }

            case "AWAITING_COUNTERPARTY_PHONE_BUY": {
                let counterpartyPhoneBuy = cleanText.replace(/\+/g, '').replace(/\s/g, '');
                if (counterpartyPhoneBuy.startsWith("0") && counterpartyPhoneBuy.length === 10) counterpartyPhoneBuy = "243" + counterpartyPhoneBuy.substring(1);
                if (!/^\d{10,15}$/.test(counterpartyPhoneBuy)) return await sendWhatsAppText(phone, MESSAGES.PHONE_INVALID);
                if (counterpartyPhoneBuy === phone) return await sendWhatsAppText(phone, MESSAGES.SELF_TRANSACTION_BLOCKED);

                // 🛡️ COMPLIANCE 1: CROSS-WALLET SELF-DEALING BLOCK
                let { data: cpUserBuy } = await supabase.from("users").select("*").eq("phone_number", counterpartyPhoneBuy).single();
                if (cpUserBuy && cpUserBuy.first_name && cpUserBuy.last_name && user.first_name && user.last_name) {
                    if (cpUserBuy.first_name.toLowerCase() === user.first_name.toLowerCase() && cpUserBuy.last_name.toLowerCase() === user.last_name.toLowerCase()) {
                        return await sendWhatsAppText(phone, "🚫 *Alerte de Sécurité* : Les transactions entre vos propres comptes (même identité) sont strictement interdites.");
                    }
                }

                // 🛡️ COMPLIANCE 2: PING-PONG INTERCEPTOR
                const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                const { count: pingPongCount } = await supabase.from("transactions")
                    .select("*", { count: "exact", head: true })
                    .or(`and(seller_phone.eq.${counterpartyPhoneBuy},buyer_phone.eq.${phone}),and(seller_phone.eq.${phone},buyer_phone.eq.${counterpartyPhoneBuy})`)
                    .gte("created_at", twentyFourHoursAgo);

                if (pingPongCount !== null && pingPongCount >= 2 && user.kyc_status !== "VERIFIED") {
                    return await sendKYCVerificationLink(phone, supabase, "Vous avez atteint la limite de transactions répétées avec ce vendeur. Une vérification d'identité est requise pour continuer.");
                }

                const { data: txBuy } = await supabase.from("transactions").update({ seller_phone: counterpartyPhoneBuy, status: "INITIATED" }).eq("id", session.draft_transaction_id).select().single();
                await supabase.from("sessions").update({ current_state: "INITIATED_BUYER" }).eq("phone_number", phone);
                await sendWhatsAppText(phone, MESSAGES.BUYER_WAITING_FOR_SELLER);
                
                await supabase.from("users").upsert({ phone_number: counterpartyPhoneBuy }, { onConflict: 'phone_number' });
                await supabase.from("sessions").upsert({ phone_number: counterpartyPhoneBuy, current_state: "INVITED_SELLER", draft_transaction_id: session.draft_transaction_id }, { onConflict: 'phone_number' });
                
                const buyerScore = user.trust_score ?? 50;
                const feeSellerDesc = MESSAGES.FEE_DESCRIPTION_FOR_SELLER(txBuy.base_amount, txBuy.currency, txBuy.fee_responsibility || 'SELLER', txBuy.applied_fee_percentage ?? 1.5);
                const inviteTextBuy = `🛡️ *Indice de Confiance de l'Acheteur : ${buyerScore}/100*\n⭐ (Basé sur l'historique des transactions sur Clairtus)\n\n` +
                    MESSAGES.SELLER_INVITE_BUTTONS(phone, txBuy.item_description) +
                    `\n\n${feeSellerDesc}`;

                await sendWhatsAppButtons(counterpartyPhoneBuy, inviteTextBuy, [
                    { id: "CMD_ACCEPTER", title: "ACCEPTER" }, { id: "CMD_REFUSER", title: "REFUSER" }, { id: "CMD_AIDE", title: "AIDE" }
                ]);
                break;
            }

            // 🛡️ KYC PENDING — user has been sent the Smile ID link and is waiting for verification.
            // Any message (including old photo submissions) re-sends the link.
            case "AWAITING_KYC_COMPLETION": {
                const { data: kycUser } = await supabase.from("users").select("kyc_status").eq("phone_number", phone).single();

                if (kycUser?.kyc_status === "VERIFIED") {
                    // Verification completed since the last check — move them along.
                    await supabase.from("sessions").update({ current_state: "MAIN_MENU" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, `✅ *Identité vérifiée !*\n\nVotre compte est maintenant débloqué. Tapez *BONJOUR* pour reprendre votre transaction.`);
                } else if (kycUser?.kyc_status === "REJECTED") {
                    const link = buildKYCLink(phone);
                    await sendWhatsAppText(phone,
                        `❌ *Vérification refusée.*\n\nVotre identité n'a pas pu être confirmée. Veuillez réessayer en cliquant sur ce lien :\n\n🔗 ${link}\n\nAssurez-vous d'utiliser un document valide et un bon éclairage.`
                    );
                } else {
                    // Still pending — re-send the link.
                    const link = buildKYCLink(phone);
                    await sendWhatsAppText(phone,
                        `⏳ *Vérification en attente…*\n\nSi vous n'avez pas encore commencé, cliquez ici :\n\n🔗 ${link}\n\nVous recevrez une notification dès que votre identité sera confirmée.`
                    );
                }
                break;
            }

            // 🚀 INVITATION ACCEPTANCE ROUTER
            case "INVITED_BUYER":
            case "INVITED_SELLER":
                if (cleanText === "CMD_AIDE" || cleanText.toUpperCase() === "AIDE") {
                    await sendWhatsAppText(phone, "🙋‍♂️ Un agent de support a été notifié et va vous contacter sous peu.");
                    await notifyAdmin("HELP_NEEDED", "Un utilisateur demande de l'aide sur une invitation.", phone, session.draft_transaction_id);
                    return;
                }
                
                if (cleanText === "CMD_ACCEPTER" || cleanText.toUpperCase() === "ACCEPTER") {
                    const cleanPhoneCheck = phone.replace(/\+/g, '').replace(/\s/g, '');
                    if (session.current_state === "INVITED_BUYER" && (cleanPhoneCheck.startsWith("24399") || cleanPhoneCheck.startsWith("24397"))) {
                        return await sendWhatsAppText(phone, MESSAGES.AIRTEL_BUYER_BLOCKED);
                    }

                    if (!user.first_name || !user.last_name) {
                        await supabase.from("sessions").update({ current_state: "AWAITING_TC_INVITED" }).eq("phone_number", phone);
                        await sendWhatsAppButtons(phone, TC_MESSAGE, [
                            { id: "CMD_ACCEPTER_TC_INVITED", title: "✅ J'ACCEPTE" },
                            { id: "CMD_REFUSER_TC_INVITED", title: "❌ JE REFUSE" }
                        ]);
                    } else {
                        await handleInviteAcceptance(phone, session, supabase);
                    }
                } else if (cleanText.toUpperCase() === "BONJOUR" || cleanText.toLowerCase() === "menu") {
                    const { data: tx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
                    
                    if (session.current_state === "INVITED_BUYER") {
                        const { data: sellerInfo } = await supabase.from("users").select("trust_score").eq("phone_number", tx.seller_phone).single();
                        const score = sellerInfo?.trust_score ?? 50;
                        const feeDescB = MESSAGES.FEE_DESCRIPTION_FOR_BUYER(tx.base_amount, tx.currency, tx.fee_responsibility || 'SELLER', tx.applied_fee_percentage ?? 1.5);
                        await sendWhatsAppButtons(phone, `🛡️ *Indice de Confiance du Vendeur : ${score}/100*\n\n` + MESSAGES.BUYER_INVITE_BUTTONS(tx.seller_phone, tx.item_description) + `\n\n${feeDescB}`, [
                            { id: "CMD_ACCEPTER", title: "ACCEPTER" }, { id: "CMD_REFUSER", title: "REFUSER" }, { id: "CMD_AIDE", title: "AIDE" }
                        ]);
                    } else {
                        const { data: buyerInfo } = await supabase.from("users").select("trust_score").eq("phone_number", tx.buyer_phone).single();
                        const score = buyerInfo?.trust_score ?? 50;
                        const feeDescS = MESSAGES.FEE_DESCRIPTION_FOR_SELLER(tx.base_amount, tx.currency, tx.fee_responsibility || 'SELLER', tx.applied_fee_percentage ?? 1.5);
                        await sendWhatsAppButtons(phone, `🛡️ *Indice de Confiance de l'Acheteur : ${score}/100*\n\n` + MESSAGES.SELLER_INVITE_BUTTONS(tx.buyer_phone, tx.item_description) + `\n\n${feeDescS}`, [
                            { id: "CMD_ACCEPTER", title: "ACCEPTER" }, { id: "CMD_REFUSER", title: "REFUSER" }, { id: "CMD_AIDE", title: "AIDE" }
                        ]);
                    }
                } else {
                    await sendWhatsAppText(phone, MESSAGES.UNKNOWN_MESSAGE);
                }
                break;

            case "AWAITING_TC_INVITED":
                if (cleanText === "CMD_ACCEPTER_TC_INVITED" || cleanText.toUpperCase() === "J'ACCEPTE") {
                    await supabase.from("sessions").update({ current_state: "AWAITING_FIRST_NAME_INVITED" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, MESSAGES.FIRST_NAME_REQUEST);
                } else {
                    await sendWhatsAppText(phone, "⚠️ Vous devez accepter les conditions pour utiliser Clairtus.");
                }
                break;

            case "AWAITING_FIRST_NAME_INVITED":
                await supabase.from("users").update({ first_name: cleanText }).eq("phone_number", phone);
                await supabase.from("sessions").update({ current_state: "AWAITING_LAST_NAME_INVITED" }).eq("phone_number", phone);
                await sendWhatsAppText(phone, MESSAGES.LAST_NAME_REQUEST);
                break;

            case "AWAITING_LAST_NAME_INVITED":
                await supabase.from("users").update({ last_name: cleanText }).eq("phone_number", phone);
                await handleInviteAcceptance(phone, session, supabase);
                break;

            // 🚀 SPLIT PAYOUT (BUYER INITIATED FLOW - SELLER ACCEPTS)
            case "AWAITING_SPLIT_CHOICE_INVITED": {
                if (cleanText === "CMD_OUI_SPLIT_INV" || cleanText.toUpperCase() === "OUI") {
                    await supabase.from("sessions").update({ current_state: "AWAITING_SECONDARY_PHONE_INVITED" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, MESSAGES.ASK_SECONDARY_PHONE);
                } else if (cleanText === "CMD_NON_SPLIT_INV" || cleanText.toUpperCase() === "NON") {
                    await finalizeContractAndPromptPayment(phone, session, supabase);
                } else {
                    await sendWhatsAppText(phone, "⚠️ Veuillez utiliser les boutons OUI ou NON.");
                }
                break;
            }

            case "AWAITING_SECONDARY_PHONE_INVITED": {
                let secPhone = cleanText.replace(/\+/g, '').replace(/\s/g, '');
                if (secPhone.startsWith("0") && secPhone.length === 10) secPhone = "243" + secPhone.substring(1);
                if (!/^\d{10,15}$/.test(secPhone)) return await sendWhatsAppText(phone, MESSAGES.PHONE_INVALID);
                if (secPhone === phone) return await sendWhatsAppText(phone, "🚫 Vous ne pouvez pas partager le paiement avec votre propre numéro.");

                await supabase.from("transactions").update({ secondary_vendor_phone: secPhone }).eq("id", session.draft_transaction_id);
                const { data: txForSplit } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
                
                await supabase.from("sessions").update({ current_state: "AWAITING_SECONDARY_AMOUNT_INVITED" }).eq("phone_number", phone);
                await sendWhatsAppText(phone, MESSAGES.ASK_SECONDARY_AMOUNT(txForSplit.base_amount, txForSplit.currency));
                break;
            }

            case "AWAITING_SECONDARY_AMOUNT_INVITED": {
                const secAmount = parseFloat(cleanText.replace(',', '.'));
                const { data: currentTx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();

                if (isNaN(secAmount) || secAmount <= 0) return await sendWhatsAppText(phone, MESSAGES.AMOUNT_INVALID_FORMAT);
                if (secAmount >= currentTx.base_amount) return await sendWhatsAppText(phone, MESSAGES.SPLIT_AMOUNT_ERROR);

                await supabase.from("transactions").update({ secondary_vendor_amount: secAmount }).eq("id", session.draft_transaction_id);
                await finalizeContractAndPromptPayment(phone, session, supabase);
                break;
            }

            // 🚀 PAYMENT & DELIVERY STATES
            case "AWAITING_PAYMENT_BUYER":
                if (cleanText === "CMD_PAYER" || cleanText.toUpperCase() === "PAYER" || cleanText === "CMD_RÉESSAYER" || cleanText.toUpperCase() === "RÉESSAYER" || cleanText.toUpperCase() === "REESSAYER") {
                    const { data: tx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
                    
                    const attempts = tx.payment_attempts || 0;
                    if (attempts >= 3) {
                        const { current, alternative } = getNetworkInfo(phone);
                        const circuitBreakerMsg = `⚠️ *Oups ! Il semble que le réseau ${current} rencontre des perturbations techniques en ce moment.*\n\nPour ne pas perdre votre transaction, que souhaitez-vous faire ?`;
                        
                        await supabase.from("sessions").update({ current_state: "CIRCUIT_BREAKER_MENU" }).eq("phone_number", phone);
                        await sendWhatsAppButtons(phone, circuitBreakerMsg, [
                            { id: "CMD_SWITCH_MNO", title: `1️⃣ Avec ${alternative}` },
                            { id: "CMD_PAUSE", title: "2️⃣ Attendre" },
                            { id: "CMD_CANCEL", title: "3️⃣ Annuler" }
                        ]);
                        return;
                    }

                    const { current: netName, alternative } = getNetworkInfo(phone);
                    const fifteenMinsAgo = new Date(Date.now() - 15 * 60000).toISOString();
                    
                    const { count } = await supabase.from("network_events")
                        .select("*", { count: "exact", head: true })
                        .eq("network", netName)
                        .eq("event_type", "DEPOSIT_FAILED")
                        .gte("created_at", fifteenMinsAgo);

                    if (count !== null && count >= 5) {
                        console.log(`🚨 [WAZE BREAKER] Global outage detected for ${netName}. Intercepting user ${phone}.`);
                        const wazeMsg = `⚠️ *Alerte Réseau Global :* Nous détectons actuellement une panne majeure chez ${netName}. De nombreux utilisateurs n'arrivent pas à payer.\n\nPour ne pas bloquer votre achat, que souhaitez-vous faire ?`;
                        
                        await supabase.from("sessions").update({ current_state: "CIRCUIT_BREAKER_MENU" }).eq("phone_number", phone);
                        await sendWhatsAppButtons(phone, wazeMsg, [
                            { id: "CMD_SWITCH_MNO", title: `1️⃣ Payer via ${alternative}` },
                            { id: "CMD_PAUSE", title: "2️⃣ Attendre" },
                            { id: "CMD_CANCEL", title: "3️⃣ Annuler" }
                        ]);
                        return;
                    }
                    
                    await sendWhatsAppText(phone, `✅ Demande en cours de préparation...\n\n📱 *Gardez votre écran ALLUMÉ et DÉVERROUILLÉ.* Le menu de votre opérateur va apparaître dans quelques secondes pour saisir votre code PIN.`);
        
                    try {
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        const newDepositId = crypto.randomUUID();
                        await supabase.from("transactions").update({ pawapay_deposit_id: newDepositId }).eq("id", tx.id);
                        await initiatePawaPayDeposit(newDepositId, phone, getDepositAmount(tx.base_amount, tx.applied_fee_percentage ?? 1.5, tx.fee_responsibility), tx.currency);
                        await supabase.from("sessions").update({ current_state: "AWAITING_DEPOSIT_CONFIRMATION" }).eq("phone_number", phone);
                    } catch (error) {
                        console.error("Payment Initiation Error:", error);
                        await sendWhatsAppText(phone, "❌ Erreur de réseau avec l'opérateur. Veuillez répondre REESSAYER pour tenter à nouveau.");
                    }
                } else {
                    await sendWhatsAppText(phone, MESSAGES.UNKNOWN_MESSAGE);
                }
                break;

            case "CIRCUIT_BREAKER_MENU":
                if (cleanText === "CMD_SWITCH_MNO" || cleanText === "1" || cleanText.toUpperCase() === "PAYER") {
                    const { alternative } = getNetworkInfo(phone);
                    await supabase.from("sessions").update({ current_state: "AWAITING_NEW_BUYER_PHONE" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, `Veuillez entrer votre numéro ${alternative} (ex: 243...) :\n\n*(La suite de la conversation se fera sur ce numéro actuel, mais la demande de paiement ira vers le nouveau numéro).*`);
                } else if (cleanText === "CMD_PAUSE" || cleanText === "2" || cleanText.toUpperCase() === "ATTENDRE") {
                    await supabase.from("sessions").update({ current_state: "AWAITING_PAYMENT_BUYER" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, "Dossier mis en attente ⏸️. Tapez *RÉESSAYER* quand vous pensez que le réseau est rétabli.");
                } else if (cleanText === "CMD_CANCEL" || cleanText === "3" || cleanText.toUpperCase() === "ANNULER") {
                    const { data: tx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
                    await supabase.from("transactions").update({ status: "CANCELLED" }).eq("id", tx.id);
                    await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, "🚫 La transaction a été annulée avec succès. Tapez BONJOUR pour revenir au menu.");
                    
                    if (tx.seller_phone && tx.seller_phone !== phone) {
                        await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", tx.seller_phone);
                        await sendWhatsAppText(tx.seller_phone, "🚫 L'acheteur a annulé la transaction en raison de problèmes techniques de son réseau mobile. Le dossier est clos.");
                    }
                } else {
                    await sendWhatsAppText(phone, "⚠️ Veuillez utiliser les boutons ou répondre par 1, 2 ou 3.");
                }
                break;

            case "AWAITING_NEW_BUYER_PHONE": {
                let newPhone = cleanText.replace(/\+/g, '').replace(/\s/g, '');
                if (newPhone.startsWith("0") && newPhone.length === 10) newPhone = "243" + newPhone.substring(1);
                if (!/^\d{10,15}$/.test(newPhone)) return await sendWhatsAppText(phone, MESSAGES.PHONE_INVALID);
                
                if (newPhone.startsWith("24399") || newPhone.startsWith("24397")) {
                    return await sendWhatsAppText(phone, MESSAGES.AIRTEL_BUYER_BLOCKED);
                }

                const { data: txToUpdate } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
                
                await supabase.from("transactions").update({ buyer_phone: newPhone, payment_attempts: 0 }).eq("id", txToUpdate.id);
                await supabase.from("sessions").update({ current_state: "AWAITING_DEPOSIT_CONFIRMATION" }).eq("phone_number", phone);
                
                if (newPhone !== phone) {
                    await sendWhatsAppText(phone, `🔄 La demande de paiement sécurisé a été envoyée au numéro ${newPhone}.`);
                }
                
                await sendWhatsAppText(phone, `✅ Demande en cours de préparation...\n\n📱 *Gardez l'écran de l'appareil Payeur ALLUMÉ et DÉVERROUILLÉ.* Le menu va apparaître dans quelques secondes...`);

                const newDepositId = crypto.randomUUID();
                await supabase.from("transactions").update({ pawapay_deposit_id: newDepositId }).eq("id", txToUpdate.id);
                
                try {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    await initiatePawaPayDeposit(newDepositId, newPhone, getDepositAmount(txToUpdate.base_amount, txToUpdate.applied_fee_percentage ?? 1.5, txToUpdate.fee_responsibility), txToUpdate.currency);
                } catch (error) {
                    await supabase.from("sessions").update({ current_state: "AWAITING_PAYMENT_BUYER" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, "❌ Erreur de réseau avec le nouvel opérateur. Veuillez répondre REESSAYER pour tenter à nouveau.");
                }
                break;
            }

            case "AWAITING_DEPOSIT_CONFIRMATION":
                if (cleanText.toUpperCase() === "REESSAYER" || cleanText.toUpperCase() === "RÉESSAYER") {
                    const { data: tx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
                    const attempts = (tx.payment_attempts || 0) + 1;
                    await supabase.from("transactions").update({ payment_attempts: attempts }).eq("id", tx.id);
                    
                    if (attempts >= 3) {
                        await supabase.from("sessions").update({ current_state: "AWAITING_PAYMENT_BUYER" }).eq("phone_number", phone);
                        return await sendWhatsAppText(phone, "⚠️ Trop de tentatives infructueuses détectées. Veuillez taper *RÉESSAYER* une dernière fois pour voir vos options de secours.");
                    }

                    await sendWhatsAppText(phone, `✅ Relance en cours...\n\n📱 *Gardez votre écran ALLUMÉ et DÉVERROUILLÉ.* Le menu de votre opérateur va apparaître dans quelques secondes.`);

                    const newDepositId = crypto.randomUUID();
                    await supabase.from("transactions").update({ pawapay_deposit_id: newDepositId }).eq("id", tx.id);
                    try {
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        await initiatePawaPayDeposit(newDepositId, tx.buyer_phone, getDepositAmount(tx.base_amount, tx.applied_fee_percentage ?? 1.5, tx.fee_responsibility), tx.currency);
                    } catch (error) {
                        await sendWhatsAppText(phone, "❌ Erreur opérateur. Veuillez patienter.");
                    }
                } else {
                    await sendWhatsAppText(phone, "⏳ Votre paiement est en cours de traitement par l'opérateur. Si vous n'avez rien reçu, envoyez REESSAYER.");
                }
                break;

            case "AWAITING_DELIVERY_SELLER": {
                let txFunded = null;
                if (session.draft_transaction_id) {
                    const { data } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
                    txFunded = data;
                }
                if (!txFunded) {
                    const { data } = await supabase.from("transactions").select("*").eq("seller_phone", phone).eq("status", "FUNDED").single();
                    txFunded = data;
                }
                if (!txFunded) {
                    await sendWhatsAppText(phone, "❌ Erreur: Aucune transaction financée trouvée.");
                    await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
                    break;
                }

                const enteredPin = cleanText.replace(/\D/g, '');
                
                if (enteredPin === txFunded.pin_code && enteredPin.length === 4) {
                    try {
                        await sendWhatsAppText(phone, MESSAGES.PAYOUT_INITIATED);

                        const feePercentage = txFunded.applied_fee_percentage ?? 1.5;
                        const feeMultiplier = feePercentage / 100;
                        const depositAmt = getDepositAmount(txFunded.base_amount, feePercentage, txFunded.fee_responsibility);
                        let secondaryGross = 0;

                        if (txFunded.secondary_vendor_phone && txFunded.secondary_vendor_amount) {
                            secondaryGross = Number(txFunded.secondary_vendor_amount);
                        }

                        const secondaryFee = Math.round(secondaryGross * feeMultiplier);
                        const totalFee = Math.round(txFunded.base_amount * feeMultiplier);
                        const primaryFee = totalFee - secondaryFee;

                        const primaryNet = parseFloat((depositAmt - secondaryGross - totalFee).toFixed(2));
                        const secondaryNet = secondaryGross - secondaryFee;

                        const primaryPayoutId = crypto.randomUUID();
                        const secondaryPayoutId = crypto.randomUUID();

                        const updatePayload: any = {
                            status: "PROCESSING_PAYOUTS",
                            primary_payout_status: "PROCESSING",
                            primary_payout_id: primaryPayoutId
                        };

                        if (txFunded.secondary_vendor_phone) {
                            updatePayload.secondary_payout_status = "PROCESSING";
                            updatePayload.secondary_payout_id = secondaryPayoutId;
                        }

                        await supabase.from("transactions").update(updatePayload).eq("id", txFunded.id);

                        const payoutPromises = [];
                        payoutPromises.push(initiatePawaPayPayout(primaryPayoutId, phone, primaryNet, txFunded.currency));
                        if (txFunded.secondary_vendor_phone && secondaryNet > 0) {
                            payoutPromises.push(initiatePawaPayPayout(secondaryPayoutId, txFunded.secondary_vendor_phone, secondaryNet, txFunded.currency));
                        }

                        const results = await Promise.allSettled(payoutPromises);
                        
                        let allFailed = true;
                        const syncUpdates: any = {};
                        
                        if (results[0].status === "rejected") {
                            console.error("Primary payout synchronously rejected:", results[0].reason);
                            syncUpdates.primary_payout_status = "FAILED";
                        } else {
                            allFailed = false;
                        }

                        if (txFunded.secondary_vendor_phone && secondaryNet > 0 && results.length > 1) {
                            if (results[1].status === "rejected") {
                                console.error("Secondary payout synchronously rejected:", results[1].reason);
                                syncUpdates.secondary_payout_status = "FAILED";
                            } else {
                                allFailed = false;
                            }
                        }

                        if (Object.keys(syncUpdates).length > 0) {
                            if (allFailed) {
                                throw new Error("All PawaPay payout requests rejected synchronously.");
                            } else {
                                await supabase.from("transactions").update(syncUpdates).eq("id", txFunded.id);
                            }
                        }

                        await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
                        
                    } catch (error) {
                        console.error("Payout Error:", error);
                        await supabase.from("transactions").update({
                            status: "PAYOUT_FAILED",
                            primary_payout_id: null,
                            secondary_payout_id: null,
                            primary_payout_status: "FAILED",
                            secondary_payout_status: txFunded.secondary_vendor_phone ? "FAILED" : null
                        }).eq("id", txFunded.id);
                        await supabase.from("sessions").upsert({ phone_number: phone, current_state: "AWAITING_NEW_PAYOUT_NUMBER", draft_transaction_id: txFunded.id }, { onConflict: 'phone_number' });
                        await sendWhatsAppText(phone, "❌ Erreur technique. L'opérateur a rejeté le dépôt.\n\n👉 *Veuillez répondre avec un NOUVEAU numéro (Airtel, Orange ou M-Pesa) pour recevoir vos fonds.*");
                    }
                } else {
                    const newAttempts = (txFunded.pin_attempts || 0) + 1;

                    if (newAttempts >= 3) {
                        await supabase.from("transactions").update({ status: "DISPUTED", pin_attempts: newAttempts }).eq("id", txFunded.id);
                        await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
                        await sendWhatsAppText(phone, `🚨 *ALERTE DE SÉCURITÉ*\n\nVous avez saisi un code PIN incorrect 3 fois. La transaction est maintenant bloquée et en statut LITIGE.\n\nNos agents de conformité vont examiner ce dossier.`);
                        await sendWhatsAppText(txFunded.buyer_phone, `🚨 *ALERTE DE SÉCURITÉ*\n\nLe vendeur a tenté de deviner votre code PIN 3 fois. La transaction a été immédiatement gelée pour protéger vos fonds.\n\nUn agent Clairtus va vous contacter sous peu.`);
                        await notifyAdmin("DISPUTE", "Le vendeur a saisi un code PIN incorrect 3 fois de suite. Fonds gelés pour suspicion de fraude.", phone, txFunded.id);
                    } else {
                        await supabase.from("transactions").update({ pin_attempts: newAttempts }).eq("id", txFunded.id);
                        await sendWhatsAppText(phone, `❌ Code PIN incorrect.\n\n⚠️ *ATTENTION :* Il vous reste ${3 - newAttempts} tentative(s) avant le blocage définitif de la transaction pour fraude.`);
                    }
                }
                break;
            }

            case "AWAITING_NEW_PAYOUT_NUMBER": {
                const { data: txToPay } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();

                const feePercentage = txToPay.applied_fee_percentage ?? 1.5;
                const feeMultiplier = feePercentage / 100;
                const depositAmtPay = getDepositAmount(txToPay.base_amount, feePercentage, txToPay.fee_responsibility);
                let secondaryGross = 0;

                if (txToPay.secondary_vendor_phone && txToPay.secondary_vendor_amount) {
                    secondaryGross = Number(txToPay.secondary_vendor_amount);
                }

                const secondaryFee = Math.round(secondaryGross * feeMultiplier);
                const totalFee = Math.round(txToPay.base_amount * feeMultiplier);
                const primaryFee = totalFee - secondaryFee;

                const primaryNet = parseFloat((depositAmtPay - secondaryGross - totalFee).toFixed(2));
                const secondaryNet = secondaryGross - secondaryFee;

                let isRetryCommand = cleanText.toUpperCase() === "RÉESSAYER" || cleanText.toUpperCase() === "REESSAYER";
                let primaryTargetPhone = isRetryCommand ? phone : cleanText.replace(/\+/g, '').replace(/\s/g, '');

                if (!isRetryCommand) {
                    if (primaryTargetPhone.startsWith("0") && primaryTargetPhone.length === 10) primaryTargetPhone = "243" + primaryTargetPhone.substring(1);
                    if (!/^\d{10,15}$/.test(primaryTargetPhone)) return await sendWhatsAppText(phone, MESSAGES.PHONE_INVALID);
                }

                const primaryPayoutId = crypto.randomUUID();
                const secondaryPayoutId = crypto.randomUUID();

                const updatePayload: any = {
                    status: "PROCESSING_PAYOUTS",
                    primary_payout_status: "PROCESSING",
                    primary_payout_id: primaryPayoutId
                };

                if (!isRetryCommand) {
                    updatePayload.seller_phone = primaryTargetPhone;
                    const updatedNote = txToPay.admin_note ? `${txToPay.admin_note} | Payout redirected to ${primaryTargetPhone}` : `Payout redirected to ${primaryTargetPhone}`;
                    updatePayload.admin_note = updatedNote;
                }

                if (txToPay.secondary_vendor_phone) {
                    updatePayload.secondary_payout_status = "PROCESSING";
                    updatePayload.secondary_payout_id = secondaryPayoutId;
                }

                if (isRetryCommand) {
                    await sendWhatsAppText(phone, "⏳ Nouvelle tentative d'envoi vers votre numéro principal...");
                } else {
                    await sendWhatsAppText(phone, `⏳ Envoi des fonds vers le nouveau numéro ${primaryTargetPhone}...`);
                }

                await supabase.from("transactions").update(updatePayload).eq("id", txToPay.id);

                try {
                    const payoutPromises = [];
                    payoutPromises.push(initiatePawaPayPayout(primaryPayoutId, primaryTargetPhone, primaryNet, txToPay.currency));
                    if (txToPay.secondary_vendor_phone && secondaryNet > 0) {
                        payoutPromises.push(initiatePawaPayPayout(secondaryPayoutId, txToPay.secondary_vendor_phone, secondaryNet, txToPay.currency));
                    }

                    const results = await Promise.allSettled(payoutPromises);
                    
                    let allFailed = true;
                    const syncUpdates: any = {};
                    
                    if (results[0].status === "rejected") {
                        console.error("Primary payout retry synchronously rejected:", results[0].reason);
                        syncUpdates.primary_payout_status = "FAILED";
                    } else {
                        allFailed = false;
                    }

                    if (txToPay.secondary_vendor_phone && secondaryNet > 0 && results.length > 1) {
                        if (results[1].status === "rejected") {
                            console.error("Secondary payout retry synchronously rejected:", results[1].reason);
                            syncUpdates.secondary_payout_status = "FAILED";
                        } else {
                            allFailed = false;
                        }
                    }

                    if (Object.keys(syncUpdates).length > 0) {
                        if (allFailed) {
                            throw new Error("All PawaPay payout requests rejected synchronously.");
                        } else {
                            await supabase.from("transactions").update(syncUpdates).eq("id", txToPay.id);
                        }
                    }

                    await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
                } catch (e) {
                    await supabase.from("transactions").update({ 
                        status: "PAYOUT_FAILED",
                        primary_payout_id: null,
                        secondary_payout_id: null,
                        primary_payout_status: "FAILED",
                        secondary_payout_status: txToPay.secondary_vendor_phone ? "FAILED" : null
                    }).eq("id", txToPay.id);
                    await sendWhatsAppText(phone, "❌ L'opérateur refuse l'envoi. Veuillez fournir un NOUVEAU numéro.");
                }
                break;
            }

            case "AWAITING_CANCELLATION_APPROVAL": {
                const { data: cancelTx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
                if (cleanText === "CMD_ACCEPTER_ANNULATION" || cleanText.toUpperCase() === "ACCEPTER" || cleanText.toUpperCase() === "REMBOURSER") {
                    await sendWhatsAppText(phone, "⏳ Annulation acceptée. Remboursement en cours...");
                    try {
                        const refundId = crypto.randomUUID();
                        const cancelApprovalRefundAmt = getDepositAmount(cancelTx.base_amount, cancelTx.applied_fee_percentage ?? 1.5, cancelTx.fee_responsibility);
                        await initiatePawaPayPayout(refundId, cancelTx.buyer_phone, cancelApprovalRefundAmt, cancelTx.currency);
                        await supabase.from("transactions").update({ status: "REFUNDED", pawapay_refund_id: refundId }).eq("id", cancelTx.id);
                        await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
                        await sendWhatsAppText(phone, "☑️ Dossier clos. L'acheteur a été remboursé.");
                        await sendWhatsAppText(cancelTx.buyer_phone, "✅ Le vendeur a accepté l'annulation. Vos fonds vous ont été remboursés.");
                        await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", cancelTx.buyer_phone);
                    } catch (error) {
                        console.error("Refund Error:", error);
                        await sendWhatsAppText(phone, "❌ Erreur technique lors du remboursement.");
                    }
                } else if (cleanText === "CMD_LITIGE" || cleanText.toUpperCase() === "LITIGE") {
                    await supabase.from("transactions").update({ status: "DISPUTED" }).eq("id", cancelTx.id);
                    await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, "🚨 La transaction est en LITIGE. Nos agents gèlent les fonds et vont vous contacter.");
                    await sendWhatsAppText(cancelTx.buyer_phone, "🚨 Le vendeur a refusé l'annulation. Le dossier part en LITIGE. Nos agents vont vous contacter.");
                    await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", cancelTx.buyer_phone);
                    await notifyAdmin("DISPUTE", "Le vendeur a refusé une demande d'annulation.", phone, cancelTx.id);
                } else {
                    await sendWhatsAppText(phone, "Veuillez utiliser les boutons ACCEPTER ou REFUSER (LITIGE).");
                }
                break;
            }

            case "AWAITING_DELIVERY_BUYER":
                if (cleanText.toUpperCase() === "LITIGE") {
                    const { data: tx } = await supabase.from("transactions").select("*").eq("buyer_phone", phone).eq("status", "FUNDED").single();
                    if (tx) {
                        await supabase.from("transactions").update({ status: "DISPUTED" }).eq("id", tx.id);
                        await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
                        await sendWhatsAppText(phone, "🚨 La transaction est maintenant en LITIGE. Les fonds sont strictement gelés. Notre équipe de conformité va vous contacter.");
                        await sendWhatsAppText(tx.seller_phone, `🚨 L'acheteur a ouvert un LITIGE sur la transaction ${tx.reference}. Les fonds sont gelés. Un agent Clairtus va vous contacter.`);
                        await notifyAdmin("DISPUTE", "L'acheteur a ouvert un litige manuel pendant la livraison.", phone, tx.id);
                    }
                } else {
                    await sendWhatsAppText(phone, "⏳ En attente de la livraison. Gardez précieusement votre code PIN.\n\n⚠️ En cas de problème grave avec le vendeur, tapez *LITIGE* pour geler les fonds.");
                }
                break;

            case "INITIATED_SELLER":
                await sendWhatsAppText(phone, MESSAGES.SELLER_WAITING_FOR_BUYER);
                break;

            case "INITIATED_BUYER":
                await sendWhatsAppText(phone, MESSAGES.BUYER_WAITING_FOR_SELLER);
                break;

            default:
                await sendWhatsAppText(phone, MESSAGES.UNKNOWN_MESSAGE);
                break;
        }
    } catch (error) {
        console.error(`🚨 FATAL ERROR IN STATE MACHINE:`, error);
    }
}

// 🚀 HELPER: SELLER ACCEPTANCE & SPLIT PAYOUT INTERCEPTOR
async function handleInviteAcceptance(phone: string, session: any, supabase: any) {
    const { data: tx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();

    // Fetch accepting user once — used for both KYC check and promo check below.
    const { data: acceptingUser } = await supabase.from("users")
        .select("kyc_status, promo_code_applied")
        .eq("phone_number", phone).single();

    // 🛡️ COMPLIANCE: KYC GATE FOR THE COUNTERPARTY ON HIGH-VALUE TRANSACTIONS
    const kycLimit = tx.currency === "USD" ? 500 : 1415000;
    if (tx.base_amount > kycLimit) {
        if (acceptingUser?.kyc_status !== "VERIFIED") {
            return await sendKYCVerificationLink(phone, supabase, `Cette transaction dépasse *${kycLimit} ${tx.currency}*. Les deux parties doivent être vérifiées pour ce montant.`);
        }
    }

    // 🎫 PROMO CHECK: If the accepting party has a promo code better than the current fee, apply it.
    // This covers the case where the initiator didn't have a promo but the counterparty does.
    const currentFeePct = tx.applied_fee_percentage ?? 1.5;
    if (currentFeePct > 0 && acceptingUser?.promo_code_applied) {
        const { data: promoData } = await supabase.from("promo_codes")
            .select("fee_percentage")
            .eq("code_name", acceptingUser.promo_code_applied)
            .eq("is_active", true)
            .gt("expires_at", new Date().toISOString())
            .single();

        if (promoData !== null && promoData.fee_percentage < currentFeePct) {
            const newFee = promoData.fee_percentage;
            await supabase.from("transactions").update({
                applied_fee_percentage: newFee,
                // When fee = 0 the responsibility choice is moot — default to SELLER
                fee_responsibility: newFee === 0 ? 'SELLER' : tx.fee_responsibility
            }).eq("id", tx.id);
            tx.applied_fee_percentage = newFee;
            if (newFee === 0) tx.fee_responsibility = 'SELLER';

            const msg = newFee === 0
                ? `🎉 *Code promo appliqué !*\n\nVotre code promo a supprimé tous les frais d'escrow sur cette transaction. Aucune charge pour aucune des deux parties !`
                : `🎉 *Code promo appliqué !*\n\nVotre code promo a réduit les frais d'escrow à ${newFee}% sur cette transaction.`;
            await sendWhatsAppText(phone, msg);

            const otherPhone = tx.seller_phone === phone ? tx.buyer_phone : tx.seller_phone;
            if (otherPhone) {
                const notif = newFee === 0
                    ? `🎉 *Bonne nouvelle !*\n\nL'autre partie a un code promo. *Aucuns frais d'escrow* ne seront prélevés sur cette transaction !`
                    : `🎉 *Bonne nouvelle !*\n\nL'autre partie a un code promo. Les frais d'escrow ont été réduits à ${newFee}% !`;
                await sendWhatsAppText(otherPhone, notif);
            }
        }
    }

    if (tx.seller_phone === phone) {
        await supabase.from("sessions").update({ current_state: "AWAITING_SPLIT_CHOICE_INVITED" }).eq("phone_number", phone);
        await sendWhatsAppButtons(phone, MESSAGES.ASK_SPLIT_CHOICE, [
            { id: "CMD_OUI_SPLIT_INV", title: "OUI" },
            { id: "CMD_NON_SPLIT_INV", title: "NON" }
        ]);
    } else {
        await finalizeContractAndPromptPayment(phone, session, supabase);
    }
}

async function finalizeContractAndPromptPayment(acceptingPhone: string, session: any, supabase: any) {
    const { data: tx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
    
    // 🛡️ COMPLIANCE: THE FINAL HANDSHAKE INTERCEPTOR
    const { data: buyerUser } = await supabase.from("users").select("*").eq("phone_number", tx.buyer_phone).single();
    const { data: sellerUser } = await supabase.from("users").select("*").eq("phone_number", tx.seller_phone).single();

    if (buyerUser && sellerUser && buyerUser.first_name && buyerUser.last_name && sellerUser.first_name && sellerUser.last_name) {
        const buyerFullName = `${buyerUser.first_name.trim().toLowerCase()} ${buyerUser.last_name.trim().toLowerCase()}`;
        const sellerFullName = `${sellerUser.first_name.trim().toLowerCase()} ${sellerUser.last_name.trim().toLowerCase()}`;

        if (buyerFullName === sellerFullName) {
            console.warn(`🚨 [COMPLIANCE] Blocked self-dealing at final handshake: ${buyerFullName}`);
            
            // Cancel the transaction
            await supabase.from("transactions").update({ status: "CANCELLED" }).eq("id", tx.id);
            
            // Reset both sessions
            await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", tx.buyer_phone);
            await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", tx.seller_phone);
            
            const alertMsg = "🚫 *Alerte de Sécurité AML* : Les transactions entre vos propres comptes (identités similaires) sont strictement interdites. Cette transaction a été annulée.";
            
            await sendWhatsAppText(tx.buyer_phone, alertMsg);
            if (tx.buyer_phone !== tx.seller_phone) {
                await sendWhatsAppText(tx.seller_phone, alertMsg);
            }
            return; // 🛑 STRICT STOP: Do not prompt payment.
        }
    }

    // 🏦 BCC COMPLIANCE: enforce the buyer's daily/monthly payment ceilings before any deposit.
    // This is the single choke point every payment path flows through, so it guarantees no
    // transaction can breach BCC Art.17 limits. Uses the actual deposit (base + buyer's fee share).
    const bccDeposit = getDepositAmount(tx.base_amount, tx.applied_fee_percentage ?? 1.5, tx.fee_responsibility);
    const bccBlock = await checkBuyerBccLimits(supabase, tx.buyer_phone, bccDeposit, tx.currency, tx.id);
    if (bccBlock) {
        // Roll the contract back to a clean state and inform both parties gracefully.
        await supabase.from("transactions").update({ status: "CANCELLED" }).eq("id", tx.id);
        await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", tx.buyer_phone);
        await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", tx.seller_phone);
        await sendWhatsAppText(tx.buyer_phone, bccBlock);
        if (tx.seller_phone && tx.seller_phone !== tx.buyer_phone) {
            await sendWhatsAppText(tx.seller_phone, `ℹ️ La transaction *${tx.reference}* n'a pas pu être finalisée : l'acheteur a atteint le plafond réglementaire BCC. Il pourra la reprendre prochainement.`);
        }
        return; // 🛑 Do not prompt payment.
    }

    // --- PROCEED WITH NORMAL PAYMENT FLOW ---
    await supabase.from("transactions").update({ status: "PENDING_FUNDING", payment_attempts: 0 }).eq("id", tx.id);

    const isAcceptingUserTheBuyer = acceptingPhone === tx.buyer_phone;
    const buyerPhone = tx.buyer_phone;
    
    const { current: netName, alternative } = getNetworkInfo(buyerPhone);
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60000).toISOString();
    
    const { count } = await supabase.from("network_events")
        .select("*", { count: "exact", head: true })
        .eq("network", netName)
        .eq("event_type", "DEPOSIT_FAILED")
        .gte("created_at", fifteenMinsAgo);

    let currencyWarning = "";
    if (tx.currency === "USD") {
        currencyWarning = `\n\n💡 *Note :* Si votre compte est en CDF, votre opérateur appliquera son propre taux de change pour atteindre le montant en USD.`;
    }

    if (isAcceptingUserTheBuyer) {
        await sendWhatsAppText(tx.seller_phone, MESSAGES.CONTRACT_ACCEPTED_SELLER_NOTIFIED);
        await supabase.from("sessions").update({ current_state: "AWAITING_PAYMENT_SELLER" }).eq("phone_number", tx.seller_phone);
    } else {
        await sendWhatsAppText(tx.buyer_phone, MESSAGES.CONTRACT_ACCEPTED_BUYER_NOTIFIED);
        await sendWhatsAppText(acceptingPhone, MESSAGES.CONTRACT_ACCEPTED_SELLER_NOTIFIED);
        await supabase.from("sessions").update({ current_state: "AWAITING_PAYMENT_SELLER" }).eq("phone_number", acceptingPhone);
    }

    if (count !== null && count >= 5) {
        console.log(`🚨 [WAZE BREAKER] Global outage detected for ${netName}. Intercepting initial payment for ${buyerPhone}.`);
        const wazeMsg = `⚠️ *Alerte Réseau Global :* Nous détectons actuellement une panne majeure chez ${netName}. De nombreux utilisateurs n'arrivent pas à payer.\n\nPour ne pas bloquer votre achat, que souhaitez-vous faire ?`;
        
        await supabase.from("sessions").update({ current_state: "CIRCUIT_BREAKER_MENU" }).eq("phone_number", buyerPhone);
        await sendWhatsAppButtons(buyerPhone, wazeMsg, [
            { id: "CMD_SWITCH_MNO", title: `1️⃣ Payer via ${alternative}` },
            { id: "CMD_PAUSE", title: "2️⃣ Attendre" },
            { id: "CMD_CANCEL", title: "3️⃣ Annuler" }
        ]);
        return;
    }

    await supabase.from("sessions").update({ current_state: "AWAITING_DEPOSIT_CONFIRMATION" }).eq("phone_number", buyerPhone);
    const preflightMsg = `✅ Demande en cours de préparation...${currencyWarning}\n\n📱 *Gardez votre écran ALLUMÉ et DÉVERROUILLÉ.* Le menu de votre opérateur va apparaître dans quelques secondes pour saisir votre code PIN.`;
    await sendWhatsAppText(buyerPhone, preflightMsg);
    
    try {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const newDepositId = crypto.randomUUID();
        await supabase.from("transactions").update({ pawapay_deposit_id: newDepositId }).eq("id", tx.id);
        await initiatePawaPayDeposit(newDepositId, buyerPhone, getDepositAmount(tx.base_amount, tx.applied_fee_percentage ?? 1.5, tx.fee_responsibility), tx.currency);
    } catch (error) {
        await supabase.from("sessions").update({ current_state: "AWAITING_PAYMENT_BUYER" }).eq("phone_number", buyerPhone);
        await sendWhatsAppText(buyerPhone, "❌ Erreur de réseau avec l'opérateur. Veuillez répondre REESSAYER pour tenter à nouveau.");
    }
}