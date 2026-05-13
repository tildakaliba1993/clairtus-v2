// supabase/functions/_shared/stateMachine.ts

import { getSupabaseClient } from "./supabaseClient.ts";
import { sendWhatsAppText, sendWhatsAppButtons, sendWhatsAppTemplate } from "./whatsappClient.ts";
import { MESSAGES } from "./whatsappMessaging.ts";
import { initiatePawaPayPayout, initiatePawaPayDeposit } from "./pawapayClient.ts"; 

const TC_MESSAGE = "📜 *Conditions d'utilisation - Clairtus*\n\n1️⃣ L'argent de l'acheteur est strictement bloqué jusqu'à livraison (code PIN).\n2️⃣ Clairtus prélève 2.5% de frais sur la vente.\n3️⃣ En cas de litige, les fonds sont gelés jusqu'à arbitrage.\n\nEn continuant, vous acceptez ces conditions.";

function getNetworkName(phone: string) {
    const clean = phone.replace(/\+/g, '').replace(/\s/g, '');
    if (clean.startsWith("24399") || clean.startsWith("24397")) return "Airtel";
    if (clean.startsWith("24384") || clean.startsWith("24385") || clean.startsWith("24389")) return "Orange";
    return "M-Pesa";
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
            await supabase.from("users").upsert({ phone_number: phone }, { onConflict: 'phone_number' });
            await supabase.from("sessions").upsert({ phone_number: phone, current_state: "AWAITING_TC" }, { onConflict: 'phone_number' });
            
            await sendWhatsAppButtons(phone, TC_MESSAGE, [
                { id: "CMD_ACCEPTER_TC", title: "✅ J'ACCEPTE" },
                { id: "CMD_REFUSER_TC", title: "❌ JE REFUSE" }
            ]);
            return;
        }

        if (user.kyc_level === "BANNED") return;

        // 🚨 GLOBAL COMMAND TRAPS
        const isCancelCommand = ["ANNULER", "CMD_ANNULER", "REFUSER", "CMD_REFUSER"].includes(cleanText.toUpperCase());
        const isPinRecoveryCommand = ["CODE", "PIN", "RECUPERER", "RÉCUPÉRER"].includes(cleanText.toUpperCase());
        const isRegistrationState = ["AWAITING_TC", "AWAITING_FIRST_NAME", "AWAITING_LAST_NAME"].includes(session.current_state);

        // 🛡️ EDGE CASE 4: PIN RECOVERY
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
                            await initiatePawaPayPayout(refundId, txToCancel.buyer_phone, txToCancel.base_amount, txToCancel.currency);
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
                await supabase.from("sessions").update({ current_state: "MAIN_MENU" }).eq("phone_number", phone);
                const { data: updatedUser } = await supabase.from("users").select("*").eq("phone_number", phone).single();
                await sendWhatsAppButtons(phone, MESSAGES.WELCOME_RETURNING(updatedUser.first_name, updatedUser.last_name), [
                    { id: "CMD_VENDRE", title: "📦 VENDRE" }, 
                    { id: "CMD_ACHETER", title: "🛒 ACHETER" },
                    { id: "CMD_TRANSACTIONS", title: "📜 HISTORIQUE" }
                ]);
                break;

            case "MAIN_MENU":
                if (cleanText.toUpperCase() === "BONJOUR" || cleanText.toLowerCase() === "menu") {
                    await sendWhatsAppButtons(phone, MESSAGES.WELCOME_RETURNING(user.first_name, user.last_name), [
                        { id: "CMD_VENDRE", title: "📦 VENDRE" }, 
                        { id: "CMD_ACHETER", title: "🛒 ACHETER" },
                        { id: "CMD_TRANSACTIONS", title: "📜 HISTORIQUE" }
                    ]);
                } else if (cleanText === "CMD_VENDRE" || cleanText.toUpperCase() === "VENDRE") {
                    const { data: staleTx } = await supabase
                        .from("transactions")
                        .select("id, reference")
                        .eq("seller_phone", phone)
                        .in("status", ["DRAFT", "INITIATED", "PENDING_FUNDING"])
                        .order('created_at', { ascending: false })
                        .limit(1).single();

                    if (staleTx) {
                        await supabase.from("sessions").update({ current_state: "CONFIRM_CANCEL_OLD", draft_transaction_id: staleTx.id }).eq("phone_number", phone);
                        return await sendWhatsAppButtons(phone, `⚠️ Vous avez déjà une transaction en attente (${staleTx.reference}).\n\nVoulez-vous l'ANNULER pour en commencer une nouvelle ?`, [
                            { id: "CMD_OUI_CANCEL_OLD", title: "✅ OUI (ANNULER)" },
                            { id: "CMD_NON_CANCEL_OLD", title: "❌ NON (GARDER)" }
                        ]);
                    }

                    await supabase.from("sessions").update({ current_state: "AWAITING_ITEM_DESCRIPTION_SELL" }).eq("phone_number", phone);
                    await sendWhatsAppText(phone, MESSAGES.SELL_ITEM_REQUEST);
                } else if (cleanText === "CMD_ACHETER" || cleanText.toUpperCase() === "ACHETER") {
                    
                    // 🔧 AIRTEL BYPASS: Prevent Airtel users from initiating a Buy transaction
                    if (getNetworkName(phone) === "Airtel") {
                        return await sendWhatsAppText(phone, "❌ Les paiements via Airtel sont temporairement suspendus. En tant qu'acheteur, veuillez utiliser un compte WhatsApp lié à un numéro M-Pesa ou Orange.");
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
                        txs.forEach((tx, index) => {
                            const role = tx.seller_phone === phone ? "Vendeur" : "Acheteur";
                            const amount = tx.base_amount ? `${tx.base_amount} ${tx.currency}` : "N/A";
                            txList += `*${index + 1}. ${tx.item_description}*\nRôle: ${role} | ${amount} | Statut: ${tx.status}\n\n`;
                        });
                        await sendWhatsAppText(phone, txList);
                    }
                } else {
                    await sendWhatsAppText(phone, MESSAGES.UNKNOWN_MESSAGE);
                }
                break;

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
                const { data: sellTx } = await supabase.from("transactions").insert({
                    reference: sellRef, seller_phone: phone, item_description: cleanText, status: "DRAFT"
                }).select().single();
                await supabase.from("sessions").update({ current_state: "AWAITING_CURRENCY_SELL", draft_transaction_id: sellTx.id }).eq("phone_number", phone);
                await sendWhatsAppButtons(phone, MESSAGES.CURRENCY_REQUEST, [{ id: "CMD_CURR_USD", title: "USD ($)" }, { id: "CMD_CURR_CDF", title: "CDF (Francs)" }]);
                break;
            }

            case "AWAITING_ITEM_DESCRIPTION_BUY": {
                const buyRef = "CLT-" + Math.random().toString(36).substring(2, 10).toUpperCase();
                const { data: buyTx } = await supabase.from("transactions").insert({
                    reference: buyRef, buyer_phone: phone, item_description: cleanText, status: "DRAFT"
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

            case "AWAITING_PRICE_SELL": {
                const priceSell = parseFloat(cleanText.replace(',', '.'));
                if (isNaN(priceSell) || priceSell <= 0) return await sendWhatsAppText(phone, MESSAGES.AMOUNT_INVALID_FORMAT);
                
                const { data: tx } = await supabase.from("transactions").update({ base_amount: priceSell }).eq("id", session.draft_transaction_id).select().single();
                await supabase.from("sessions").update({ current_state: "AWAITING_COUNTERPARTY_PHONE_SELL" }).eq("phone_number", phone);
                
                // 🔧 AIRTEL BYPASS: Inform the seller to not use Airtel numbers for buyers
                await sendWhatsAppText(phone, MESSAGES.COUNTERPARTY_PHONE_REQUEST_SELL(priceSell, tx.currency) + "\n\n⚠️ *Veuillez utiliser un numéro M-Pesa ou Orange (Airtel indisponible pour les paiements actuellement).*");
                break;
            }

            case "AWAITING_PRICE_BUY": {
                const priceBuy = parseFloat(cleanText.replace(',', '.'));
                if (isNaN(priceBuy) || priceBuy <= 0) return await sendWhatsAppText(phone, MESSAGES.AMOUNT_INVALID_FORMAT);
                
                const { data: tx } = await supabase.from("transactions").update({ base_amount: priceBuy }).eq("id", session.draft_transaction_id).select().single();
                await supabase.from("sessions").update({ current_state: "AWAITING_COUNTERPARTY_PHONE_BUY" }).eq("phone_number", phone);
                await sendWhatsAppText(phone, MESSAGES.COUNTERPARTY_PHONE_REQUEST_BUY(priceBuy, tx.currency));
                break;
            }

            case "AWAITING_COUNTERPARTY_PHONE_SELL": {
                let counterpartyPhone = cleanText.replace(/\+/g, '').replace(/\s/g, '');
                if (counterpartyPhone.startsWith("0") && counterpartyPhone.length === 10) counterpartyPhone = "243" + counterpartyPhone.substring(1);
                if (!/^\d{10,15}$/.test(counterpartyPhone)) return await sendWhatsAppText(phone, MESSAGES.PHONE_INVALID);
                if (counterpartyPhone === phone) return await sendWhatsAppText(phone, MESSAGES.SELF_TRANSACTION_BLOCKED);
                
                // 🔧 AIRTEL BYPASS: Hard block if seller tries to input an Airtel buyer
                if (getNetworkName(counterpartyPhone) === "Airtel") {
                    return await sendWhatsAppText(phone, "❌ L'acheteur ne peut pas utiliser Airtel pour payer. Veuillez fournir un numéro M-Pesa ou Orange.");
                }

                const { data: txSell } = await supabase.from("transactions").update({ buyer_phone: counterpartyPhone, status: "INITIATED" }).eq("id", session.draft_transaction_id).select().single();
                await supabase.from("sessions").update({ current_state: "INITIATED_SELLER" }).eq("phone_number", phone);
                await sendWhatsAppText(phone, MESSAGES.SELLER_WAITING_FOR_BUYER);
                
                await supabase.from("users").upsert({ phone_number: counterpartyPhone }, { onConflict: 'phone_number' });
                await supabase.from("sessions").upsert({ phone_number: counterpartyPhone, current_state: "INVITED_BUYER", draft_transaction_id: session.draft_transaction_id }, { onConflict: 'phone_number' });
                
                await sendWhatsAppButtons(counterpartyPhone, MESSAGES.BUYER_INVITE_BUTTONS(phone, txSell.item_description), [
                    { id: "CMD_ACCEPTER", title: "ACCEPTER" }, { id: "CMD_REFUSER", title: "REFUSER" }, { id: "CMD_AIDE", title: "AIDE" }
                ]);
                break;
            }

            case "AWAITING_COUNTERPARTY_PHONE_BUY": {
                let counterpartyPhoneBuy = cleanText.replace(/\+/g, '').replace(/\s/g, '');
                if (counterpartyPhoneBuy.startsWith("0") && counterpartyPhoneBuy.length === 10) counterpartyPhoneBuy = "243" + counterpartyPhoneBuy.substring(1);
                if (!/^\d{10,15}$/.test(counterpartyPhoneBuy)) return await sendWhatsAppText(phone, MESSAGES.PHONE_INVALID);
                if (counterpartyPhoneBuy === phone) return await sendWhatsAppText(phone, MESSAGES.SELF_TRANSACTION_BLOCKED);
                
                const { data: txBuy } = await supabase.from("transactions").update({ seller_phone: counterpartyPhoneBuy, status: "INITIATED" }).eq("id", session.draft_transaction_id).select().single();
                await supabase.from("sessions").update({ current_state: "INITIATED_BUYER" }).eq("phone_number", phone);
                await sendWhatsAppText(phone, MESSAGES.BUYER_WAITING_FOR_SELLER);
                
                await supabase.from("users").upsert({ phone_number: counterpartyPhoneBuy }, { onConflict: 'phone_number' });
                await supabase.from("sessions").upsert({ phone_number: counterpartyPhoneBuy, current_state: "INVITED_SELLER", draft_transaction_id: session.draft_transaction_id }, { onConflict: 'phone_number' });
                
                await sendWhatsAppButtons(counterpartyPhoneBuy, MESSAGES.SELLER_INVITE_BUTTONS(phone, txBuy.item_description), [
                    { id: "CMD_ACCEPTER", title: "ACCEPTER" }, { id: "CMD_REFUSER", title: "REFUSER" }, { id: "CMD_AIDE", title: "AIDE" }
                ]);
                break;
            }

            case "INVITED_BUYER":
            case "INVITED_SELLER":
                if (cleanText === "CMD_ACCEPTER" || cleanText.toUpperCase() === "ACCEPTER") {
                    
                    // 🔧 AIRTEL BYPASS: Hard block if an Airtel user tries to accept an invitation to act as a buyer
                    if (session.current_state === "INVITED_BUYER" && getNetworkName(phone) === "Airtel") {
                        return await sendWhatsAppText(phone, "❌ Les paiements via Airtel sont temporairement suspendus. Vous ne pouvez pas accepter et payer cette transaction avec un numéro Airtel.");
                    }

                    if (!user.first_name || !user.last_name) {
                        await supabase.from("sessions").update({ current_state: "AWAITING_TC_INVITED" }).eq("phone_number", phone);
                        await sendWhatsAppButtons(phone, TC_MESSAGE, [
                            { id: "CMD_ACCEPTER_TC_INVITED", title: "✅ J'ACCEPTE" },
                            { id: "CMD_REFUSER_TC_INVITED", title: "❌ JE REFUSE" }
                        ]);
                    } else {
                        await finalizeContractAndPromptPayment(phone, session, supabase);
                    }
                } else if (cleanText.toUpperCase() === "BONJOUR" || cleanText.toLowerCase() === "menu") {
                    const { data: tx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
                    if (session.current_state === "INVITED_BUYER") {
                        await sendWhatsAppButtons(phone, MESSAGES.BUYER_INVITE_BUTTONS(tx.seller_phone, tx.item_description), [
                            { id: "CMD_ACCEPTER", title: "ACCEPTER" }, { id: "CMD_REFUSER", title: "REFUSER" }, { id: "CMD_AIDE", title: "AIDE" }
                        ]);
                    } else {
                        await sendWhatsAppButtons(phone, MESSAGES.SELLER_INVITE_BUTTONS(tx.buyer_phone, tx.item_description), [
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
                await finalizeContractAndPromptPayment(phone, session, supabase);
                break;

            case "AWAITING_PAYMENT_BUYER":
                if (cleanText === "CMD_PAYER" || cleanText.toUpperCase() === "PAYER" || cleanText === "CMD_RÉESSAYER" || cleanText.toUpperCase() === "RÉESSAYER" || cleanText.toUpperCase() === "REESSAYER") {
                    const { data: tx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
                    await sendWhatsAppText(phone, MESSAGES.DEPOSIT_INITIATED);
                    
                    try {
                        const newDepositId = crypto.randomUUID();
                        await supabase.from("transactions").update({ pawapay_deposit_id: newDepositId }).eq("id", tx.id);
                        await initiatePawaPayDeposit(newDepositId, phone, tx.base_amount, tx.currency);
                        await supabase.from("sessions").update({ current_state: "AWAITING_DEPOSIT_CONFIRMATION" }).eq("phone_number", phone);
                    } catch (error) {
                        console.error("Payment Initiation Error:", error);
                        await sendWhatsAppText(phone, "❌ Erreur de réseau avec l'opérateur. Veuillez répondre REESSAYER pour tenter à nouveau.");
                    }
                } else {
                    await sendWhatsAppText(phone, MESSAGES.UNKNOWN_MESSAGE);
                }
                break;

            case "AWAITING_DEPOSIT_CONFIRMATION":
                if (cleanText.toUpperCase() === "REESSAYER" || cleanText.toUpperCase() === "RÉESSAYER") {
                    const { data: tx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
                    const newDepositId = crypto.randomUUID();
                    await supabase.from("transactions").update({ pawapay_deposit_id: newDepositId }).eq("id", tx.id);
                    try {
                        await initiatePawaPayDeposit(newDepositId, phone, tx.base_amount, tx.currency);
                        await sendWhatsAppText(phone, "🔄 La demande a été renvoyée. Vérifiez votre écran de téléphone pour le code PIN M-Pesa/Airtel.");
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
                        const payoutId = crypto.randomUUID();
                        const payoutAmount = Number((txFunded.base_amount * 0.975).toFixed(2));
                        await sendWhatsAppText(phone, MESSAGES.PAYOUT_INITIATED);
                        
                        await supabase.from("transactions").update({ pawapay_payout_id: payoutId }).eq("id", txFunded.id);
                        await initiatePawaPayPayout(payoutId, phone, payoutAmount, txFunded.currency);
                        
                        await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
                        await sendWhatsAppText(txFunded.buyer_phone, MESSAGES.PAYMENT_SUCCESS_BUYER_FINAL || "✅ Transaction clôturée.\n\nLe code PIN a été utilisé avec succès. Le vendeur a reçu son argent."); 
                        await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", txFunded.buyer_phone);
                    } catch (error) {
                        console.error("Payout Error:", error);
                        await supabase.from("transactions").update({ status: "PAYOUT_FAILED" }).eq("id", txFunded.id);
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
                    } else {
                        await supabase.from("transactions").update({ pin_attempts: newAttempts }).eq("id", txFunded.id);
                        await sendWhatsAppText(phone, `❌ Code PIN incorrect.\n\n⚠️ *ATTENTION :* Il vous reste ${3 - newAttempts} tentative(s) avant le blocage définitif de la transaction pour fraude.`);
                    }
                }
                break;
            }

            case "AWAITING_NEW_PAYOUT_NUMBER": {
                const { data: txToPay } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
                
                if (cleanText.toUpperCase() === "RÉESSAYER" || cleanText.toUpperCase() === "REESSAYER") {
                    const payoutId = crypto.randomUUID();
                    const payoutAmount = Number((txToPay.base_amount * 0.975).toFixed(2));
                    await sendWhatsAppText(phone, "⏳ Nouvelle tentative d'envoi vers votre numéro principal...");
                    await supabase.from("transactions").update({ pawapay_payout_id: payoutId }).eq("id", txToPay.id);
                    try {
                        await initiatePawaPayPayout(payoutId, phone, payoutAmount, txToPay.currency);
                        await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
                    } catch (e) {
                        await sendWhatsAppText(phone, "❌ L'opérateur refuse toujours l'envoi. Veuillez fournir un NOUVEAU numéro.");
                    }
                } else {
                    let newPhone = cleanText.replace(/\+/g, '').replace(/\s/g, '');
                    if (newPhone.startsWith("0") && newPhone.length === 10) newPhone = "243" + newPhone.substring(1);
                    if (!/^\d{10,15}$/.test(newPhone)) return await sendWhatsAppText(phone, MESSAGES.PHONE_INVALID);
                    
                    const payoutId = crypto.randomUUID();
                    const payoutAmount = Number((txToPay.base_amount * 0.975).toFixed(2));
                    await sendWhatsAppText(phone, `⏳ Envoi des fonds vers le nouveau numéro ${newPhone}...`);
                    
                    const updatedNote = txToPay.admin_note ? `${txToPay.admin_note} | Payout redirected to ${newPhone}` : `Payout redirected to ${newPhone}`;
                    await supabase.from("transactions").update({ pawapay_payout_id: payoutId, admin_note: updatedNote, seller_phone: newPhone }).eq("id", txToPay.id);
                    
                    try {
                        await initiatePawaPayPayout(payoutId, newPhone, payoutAmount, txToPay.currency);
                        await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
                    } catch (e) {
                        await sendWhatsAppText(phone, "❌ Le nouveau numéro a également été rejeté par l'opérateur.");
                    }
                }
                break;
            }

            case "AWAITING_CANCELLATION_APPROVAL": {
                const { data: cancelTx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
                if (cleanText === "CMD_ACCEPTER_ANNULATION" || cleanText.toUpperCase() === "ACCEPTER" || cleanText.toUpperCase() === "REMBOURSER") {
                    await sendWhatsAppText(phone, "⏳ Annulation acceptée. Remboursement en cours...");
                    try {
                        const refundId = crypto.randomUUID();
                        await initiatePawaPayPayout(refundId, cancelTx.buyer_phone, cancelTx.base_amount, cancelTx.currency);
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

async function finalizeContractAndPromptPayment(acceptingPhone: string, session: any, supabase: any) {
    const { data: tx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
    await supabase.from("transactions").update({ status: "PENDING_FUNDING" }).eq("id", tx.id);
    
    const isAcceptingUserTheBuyer = acceptingPhone === tx.buyer_phone;
    
    const netName = getNetworkName(tx.buyer_phone);
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60000).toISOString();
    
    const { count } = await supabase.from("network_events")
        .select("*", { count: "exact", head: true })
        .eq("network", netName)
        .gte("created_at", fifteenMinsAgo);

    let warning = "";
    if (count !== null && count >= 2) {
        warning = `\n\n⚠️ *ALERTE RÉSEAU :* Nous détectons actuellement des instabilités chez ${netName}. Le paiement peut nécessiter d'appuyer sur RÉESSAYER en cas d'échec du premier essai.`;
    }

    let currencyWarning = "";
    if (tx.currency === "USD") {
        currencyWarning = `\n\n💡 *Note :* Si votre compte est en CDF, votre opérateur appliquera son propre taux de change pour atteindre le montant en USD.`;
    }

    if (isAcceptingUserTheBuyer) {
        await sendWhatsAppText(tx.seller_phone, MESSAGES.CONTRACT_ACCEPTED_SELLER_NOTIFIED);
        await supabase.from("sessions").update({ current_state: "AWAITING_PAYMENT_SELLER" }).eq("phone_number", tx.seller_phone);
        
        const newDepositId = crypto.randomUUID();
        await supabase.from("transactions").update({ pawapay_deposit_id: newDepositId }).eq("id", tx.id);
        
        await supabase.from("sessions").update({ current_state: "AWAITING_DEPOSIT_CONFIRMATION" }).eq("phone_number", acceptingPhone);
        await sendWhatsAppText(acceptingPhone, MESSAGES.DEPOSIT_INITIATED + currencyWarning + warning);
        
        try {
            await initiatePawaPayDeposit(newDepositId, acceptingPhone, tx.base_amount, tx.currency);
        } catch (error) {
            await supabase.from("sessions").update({ current_state: "AWAITING_PAYMENT_BUYER" }).eq("phone_number", acceptingPhone);
            await sendWhatsAppText(acceptingPhone, "❌ Erreur de réseau avec l'opérateur. Veuillez répondre REESSAYER pour tenter à nouveau.");
        }
    } else {
        await sendWhatsAppText(acceptingPhone, MESSAGES.CONTRACT_ACCEPTED_BUYER_NOTIFIED);
        await supabase.from("sessions").update({ current_state: "AWAITING_PAYMENT_SELLER" }).eq("phone_number", acceptingPhone);
        
        const newDepositId = crypto.randomUUID();
        await supabase.from("transactions").update({ pawapay_deposit_id: newDepositId }).eq("id", tx.id);
        
        await supabase.from("sessions").update({ current_state: "AWAITING_DEPOSIT_CONFIRMATION" }).eq("phone_number", tx.buyer_phone);
        await sendWhatsAppText(tx.buyer_phone, MESSAGES.DEPOSIT_INITIATED + currencyWarning + warning);
        
        try {
            await initiatePawaPayDeposit(newDepositId, tx.buyer_phone, tx.base_amount, tx.currency);
        } catch (error) {
            await supabase.from("sessions").update({ current_state: "AWAITING_PAYMENT_BUYER" }).eq("phone_number", tx.buyer_phone);
            await sendWhatsAppText(tx.buyer_phone, "❌ Erreur de réseau avec l'opérateur. Veuillez répondre REESSAYER pour tenter à nouveau.");
        }
    }
}