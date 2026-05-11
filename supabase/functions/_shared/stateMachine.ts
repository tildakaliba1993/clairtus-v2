// supabase/functions/_shared/stateMachine.ts
import { getSupabaseClient } from "./supabaseClient.ts";
import { sendWhatsAppText, sendWhatsAppButtons, sendWhatsAppTemplate } from "./whatsappClient.ts";
import { MESSAGES } from "./whatsappMessaging.ts";
import { initiatePawaPayDeposit, initiatePawaPayPayout } from "./pawapayClient.ts";

export async function processMessage(phone: string, text: string) {
  const supabase = getSupabaseClient();
  const cleanText = text.trim();

  console.log(`\n--- 🚀 NEW MESSAGE START ---`);
  console.log(`[State Machine] Processing message from ${phone}: "${cleanText}"`);

  try {
    let { data: user } = await supabase.from("users").select("*").eq("phone_number", phone).single();
    let { data: session } = await supabase.from("sessions").select("*").eq("phone_number", phone).single();

    if (!user || !session) {
      await supabase.from("users").upsert({ phone_number: phone });
      await supabase.from("sessions").upsert({ phone_number: phone, current_state: "AWAITING_FIRST_NAME" });
      await sendWhatsAppText(phone, MESSAGES.FIRST_NAME_REQUEST);
      return;
    }

    // 🚨 THE GLOBAL CANCEL & REFUND TRAP
    const isCancelCommand = ["ANNULER", "CMD_ANNULER", "REFUSER", "CMD_REFUSER"].includes(cleanText.toUpperCase());
    const isRegistrationState = ["AWAITING_FIRST_NAME", "AWAITING_LAST_NAME", "AWAITING_FIRST_NAME_INVITED", "AWAITING_LAST_NAME_INVITED"].includes(session.current_state);

    if (isCancelCommand && !isRegistrationState) {
      console.log(`[Global Cancel] Triggered by ${phone}`);
      
      let txToCancel = null;
      if (session.draft_transaction_id) {
        const { data } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
        txToCancel = data;
      }
      if (!txToCancel) {
        const { data } = await supabase.from("transactions").select("*")
          .or(`seller_phone.eq.${phone},buyer_phone.eq.${phone}`)
          .in('status', ['INITIATED', 'PENDING_FUNDING', 'FUNDED', 'CANCELLATION_REQUESTED'])
          .order('created_at', { ascending: false })
          .limit(1).single();
        txToCancel = data;
      }

      if (txToCancel) {
        // 🛡️ THE DUAL-LOCK REFUND ARCHITECTURE
        if (txToCancel.status === "FUNDED") {
          
          // SCENARIO 1: Seller cancels (100% safe to auto-refund)
          if (phone === txToCancel.seller_phone) {
             console.log(`[Refund] Seller initiated safe cancellation for TX ${txToCancel.reference}`);
             await sendWhatsAppText(phone, "⏳ Annulation confirmée. Remboursement automatique de l'acheteur en cours...");
             
             try {
                const refundId = crypto.randomUUID();
                await initiatePawaPayPayout(refundId, txToCancel.base_amount, txToCancel.buyer_phone);
                await supabase.from("transactions").update({ status: "REFUNDED" }).eq("id", txToCancel.id);
                
                await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
                await sendWhatsAppText(phone, "☑️ Le contrat a été annulé et l'acheteur a été remboursé. Tapez BONJOUR pour revenir au menu.");
                
                await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", txToCancel.buyer_phone);
                await sendWhatsAppText(txToCancel.buyer_phone, `🚨 Le vendeur a annulé la transaction.\n\n✅ Un remboursement de ${txToCancel.base_amount} $ a été envoyé sur votre compte Mobile Money.`);
             } catch (error) {
                console.error("Refund Error:", error);
                await sendWhatsAppText(phone, "❌ Erreur technique lors du remboursement. Le support a été alerté.");
             }
             return;
          } 
          
          // SCENARIO 2: Buyer cancels (Requires Seller Approval)
          else if (phone === txToCancel.buyer_phone) {
             console.log(`[Refund] Buyer requesting cancellation for TX ${txToCancel.reference}`);
             
             await supabase.from("transactions").update({ status: "CANCELLATION_REQUESTED" }).eq("id", txToCancel.id);
             await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
             await sendWhatsAppText(phone, "⏳ Votre demande d'annulation a été envoyée au vendeur pour approbation. S'il accepte, vous serez remboursé immédiatement.");
             
             await supabase.from("sessions").update({ current_state: "AWAITING_CANCELLATION_APPROVAL", draft_transaction_id: txToCancel.id }).eq("phone_number", txToCancel.seller_phone);
             await sendWhatsAppButtons(txToCancel.seller_phone, `⚠️ L'acheteur souhaite annuler la transaction de ${txToCancel.base_amount} $ et être remboursé.\n\nSi vous n'avez pas encore livré l'article, veuillez accepter l'annulation.`, [
                { id: "CMD_ACCEPTER_ANNULATION", title: "ACCEPTER" }, 
                { id: "CMD_LITIGE", title: "REFUSER (LITIGE)" }
             ]);
             return;
          }
        }

        // Standard Cancel Logic (Before money is locked)
        await supabase.from("transactions").update({ status: "CANCELLED" }).eq("id", txToCancel.id);
        const counterpartyPhone = (txToCancel.seller_phone === phone) ? txToCancel.buyer_phone : txToCancel.seller_phone;
        
        if (counterpartyPhone && counterpartyPhone !== phone) {
          await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", counterpartyPhone);
          await sendWhatsAppText(counterpartyPhone, "🚫 L'autre partie a annulé la transaction. Le dossier est clos. Tapez BONJOUR pour revenir au menu.");
        }
      }
      
      await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
      await sendWhatsAppText(phone, "☑️ Action annulée avec succès. Tapez BONJOUR pour revenir au menu.");
      return; 
    }

    // 🚦 STATE ROUTING
    switch (session.current_state) {
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
          { id: "CMD_VENDRE", title: "VENDRE" }, { id: "CMD_ACHETER", title: "ACHETER" }, { id: "CMD_TRANSACTIONS", title: "MES TRANSACTIONS" }
        ]);
        break;

      case "MAIN_MENU":
        if (cleanText.toUpperCase() === "BONJOUR") {
          await sendWhatsAppButtons(phone, MESSAGES.WELCOME_RETURNING(user.first_name, user.last_name), [
            { id: "CMD_VENDRE", title: "VENDRE" }, { id: "CMD_ACHETER", title: "ACHETER" }, { id: "CMD_TRANSACTIONS", title: "MES TRANSACTIONS" }
          ]);
        } else if (cleanText === "CMD_VENDRE" || cleanText.toUpperCase() === "VENDRE") {
          await supabase.from("sessions").update({ current_state: "AWAITING_ITEM_DESCRIPTION_SELL" }).eq("phone_number", phone);
          await sendWhatsAppText(phone, MESSAGES.SELL_ITEM_REQUEST);
        } else if (cleanText === "CMD_ACHETER" || cleanText.toUpperCase() === "ACHETER") {
          await supabase.from("sessions").update({ current_state: "AWAITING_ITEM_DESCRIPTION_BUY" }).eq("phone_number", phone);
          await sendWhatsAppText(phone, MESSAGES.BUY_ITEM_REQUEST);
        } else {
          await sendWhatsAppText(phone, MESSAGES.UNKNOWN_MESSAGE);
        }
        break;

      case "AWAITING_ITEM_DESCRIPTION_SELL":
        const sellRef = "CLT-" + Math.random().toString(36).substring(2, 10).toUpperCase();
        const { data: sellTx } = await supabase.from("transactions").insert({ reference: sellRef, seller_phone: phone, item_description: cleanText, status: "DRAFT" }).select().single();
        await supabase.from("sessions").update({ current_state: "AWAITING_PRICE_SELL", draft_transaction_id: sellTx.id }).eq("phone_number", phone);
        await sendWhatsAppText(phone, MESSAGES.PRICE_REQUEST_SELL(cleanText));
        break;

      case "AWAITING_ITEM_DESCRIPTION_BUY":
        const buyRef = "CLT-" + Math.random().toString(36).substring(2, 10).toUpperCase();
        const { data: buyTx } = await supabase.from("transactions").insert({ reference: buyRef, buyer_phone: phone, item_description: cleanText, status: "DRAFT" }).select().single();
        await supabase.from("sessions").update({ current_state: "AWAITING_PRICE_BUY", draft_transaction_id: buyTx.id }).eq("phone_number", phone);
        await sendWhatsAppText(phone, MESSAGES.PRICE_REQUEST_BUY(cleanText));
        break;

      case "AWAITING_PRICE_SELL": {
        const priceSell = parseFloat(cleanText.replace(',', '.'));
        if (isNaN(priceSell) || priceSell <= 0) return await sendWhatsAppText(phone, MESSAGES.AMOUNT_INVALID_FORMAT);
        await supabase.from("transactions").update({ base_amount: priceSell }).eq("id", session.draft_transaction_id);
        await supabase.from("sessions").update({ current_state: "AWAITING_COUNTERPARTY_PHONE_SELL" }).eq("phone_number", phone);
        await sendWhatsAppText(phone, MESSAGES.COUNTERPARTY_PHONE_REQUEST_SELL(priceSell));
        break;
      }

      case "AWAITING_PRICE_BUY": {
        const priceBuy = parseFloat(cleanText.replace(',', '.'));
        if (isNaN(priceBuy) || priceBuy <= 0) return await sendWhatsAppText(phone, MESSAGES.AMOUNT_INVALID_FORMAT);
        await supabase.from("transactions").update({ base_amount: priceBuy }).eq("id", session.draft_transaction_id);
        await supabase.from("sessions").update({ current_state: "AWAITING_COUNTERPARTY_PHONE_BUY" }).eq("phone_number", phone);
        await sendWhatsAppText(phone, MESSAGES.COUNTERPARTY_PHONE_REQUEST_BUY(priceBuy));
        break;
      }
      
      case "AWAITING_COUNTERPARTY_PHONE_SELL": {
        let counterpartyPhone = cleanText.replace(/\+/g, '').replace(/\s/g, '');
        if (counterpartyPhone.startsWith("0") && counterpartyPhone.length >= 10) counterpartyPhone = "243" + counterpartyPhone.substring(1);
        if (!/^\d{10,15}$/.test(counterpartyPhone)) return await sendWhatsAppText(phone, MESSAGES.PHONE_INVALID);
        if (counterpartyPhone === phone) return await sendWhatsAppText(phone, MESSAGES.SELF_TRANSACTION_BLOCKED);

        const { data: txSell } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
        await supabase.from("transactions").update({ buyer_phone: counterpartyPhone, status: "INITIATED" }).eq("id", session.draft_transaction_id);
        await supabase.from("sessions").update({ current_state: "INITIATED_SELLER" }).eq("phone_number", phone);
        await sendWhatsAppText(phone, MESSAGES.SELLER_WAITING_FOR_BUYER);

        await supabase.from("users").upsert({ phone_number: counterpartyPhone }, { onConflict: 'phone_number' });
        await supabase.from("sessions").upsert({ phone_number: counterpartyPhone, current_state: "INVITED_BUYER", draft_transaction_id: session.draft_transaction_id }, { onConflict: 'phone_number' });

        await sendWhatsAppTemplate(counterpartyPhone, "invite_acheteur", [phone, txSell.item_description, txSell.base_amount.toString()]);
        break;
      }

      case "AWAITING_COUNTERPARTY_PHONE_BUY": {
        let counterpartyPhoneBuy = cleanText.replace(/\+/g, '').replace(/\s/g, '');
        if (counterpartyPhoneBuy.startsWith("0") && counterpartyPhoneBuy.length >= 10) counterpartyPhoneBuy = "243" + counterpartyPhoneBuy.substring(1);
        if (!/^\d{10,15}$/.test(counterpartyPhoneBuy)) return await sendWhatsAppText(phone, MESSAGES.PHONE_INVALID);
        if (counterpartyPhoneBuy === phone) return await sendWhatsAppText(phone, MESSAGES.SELF_TRANSACTION_BLOCKED);

        const { data: txBuy } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
        await supabase.from("transactions").update({ seller_phone: counterpartyPhoneBuy, status: "INITIATED" }).eq("id", session.draft_transaction_id);
        await supabase.from("sessions").update({ current_state: "INITIATED_BUYER" }).eq("phone_number", phone);
        await sendWhatsAppText(phone, MESSAGES.BUYER_WAITING_FOR_SELLER);

        await supabase.from("users").upsert({ phone_number: counterpartyPhoneBuy }, { onConflict: 'phone_number' });
        await supabase.from("sessions").upsert({ phone_number: counterpartyPhoneBuy, current_state: "INVITED_SELLER", draft_transaction_id: session.draft_transaction_id }, { onConflict: 'phone_number' });

        await sendWhatsAppTemplate(counterpartyPhoneBuy, "invite_vendeur", [phone, txBuy.item_description, txBuy.base_amount.toString()]);
        break;
      }

      case "INVITED_BUYER":
      case "INVITED_SELLER":
        if (cleanText === "CMD_ACCEPTER" || cleanText.toUpperCase() === "ACCEPTER") {
          if (!user.first_name || !user.last_name) {
            await supabase.from("sessions").update({ current_state: "AWAITING_FIRST_NAME_INVITED" }).eq("phone_number", phone);
            await sendWhatsAppText(phone, MESSAGES.FIRST_NAME_REQUEST);
          } else {
            await finalizeContractAndPromptPayment(phone, session, supabase);
          }
        } else if (cleanText.toUpperCase() === "BONJOUR") {
          const { data: tx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
          if (session.current_state === "INVITED_BUYER") {
            await sendWhatsAppTemplate(phone, "invite_acheteur", [tx.seller_phone, tx.item_description, tx.base_amount.toString()]);
          } else {
            await sendWhatsAppTemplate(phone, "invite_vendeur", [tx.buyer_phone, tx.item_description, tx.base_amount.toString()]);
          }
        } else {
          await sendWhatsAppText(phone, MESSAGES.UNKNOWN_MESSAGE);
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
        if (cleanText === "CMD_PAYER" || cleanText.toUpperCase() === "PAYER") {
          const { data: tx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
          await sendWhatsAppText(phone, MESSAGES.DEPOSIT_INITIATED);
          
          try {
            const depositId = crypto.randomUUID();
            await initiatePawaPayDeposit(depositId, tx.base_amount, phone);
            await supabase.from("transactions").update({ pawapay_deposit_id: depositId }).eq("id", tx.id);
            await supabase.from("sessions").update({ current_state: "AWAITING_DEPOSIT_CONFIRMATION" }).eq("phone_number", phone);
          } catch (error) {
            console.error("Payment Error:", error);
            await sendWhatsAppText(phone, MESSAGES.DEPOSIT_ERROR);
          }
        } else {
          await sendWhatsAppText(phone, MESSAGES.UNKNOWN_MESSAGE);
        }
        break;

      case "AWAITING_DEPOSIT_CONFIRMATION":
        await sendWhatsAppText(phone, "⏳ Votre paiement est en cours de traitement par votre opérateur. Veuillez patienter.");
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
          await sendWhatsAppText(phone, "❌ Erreur: Aucune transaction en attente de livraison trouvée. Tapez BONJOUR pour revenir au menu.");
          await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
          break;
        }

        const enteredPin = cleanText.replace(/\D/g, '');
        
        if (enteredPin === txFunded.pin_code && enteredPin.length > 0) {
          try {
            const payoutId = crypto.randomUUID();
            const payoutAmount = Number((txFunded.base_amount * 0.975).toFixed(2));
            
            await sendWhatsAppText(phone, MESSAGES.PAYOUT_INITIATED(payoutAmount));
            await initiatePawaPayPayout(payoutId, payoutAmount, phone);
            
            await supabase.from("transactions").update({ status: "COMPLETED", pawapay_payout_id: payoutId }).eq("id", txFunded.id);
            await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
            await sendWhatsAppText(txFunded.buyer_phone, MESSAGES.BUYER_DELIVERY_CONFIRMED);
            await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", txFunded.buyer_phone);

          } catch (error) {
            console.error("Payout Error:", error);
            await sendWhatsAppText(phone, "❌ Erreur technique lors du transfert. Notre équipe a été alertée.");
          }
        } else {
          await sendWhatsAppText(phone, MESSAGES.PIN_INVALID);
        }
        break;
      }

      // ⚖️ THE NEW CANCELLATION APPROVAL STATE
      case "AWAITING_CANCELLATION_APPROVAL": {
        const { data: cancelTx } = await supabase.from("transactions").select("*").eq("id", session.draft_transaction_id).single();
        
        if (cleanText === "CMD_ACCEPTER_ANNULATION" || cleanText.toUpperCase() === "ACCEPTER") {
           await sendWhatsAppText(phone, "⏳ Annulation acceptée. Remboursement de l'acheteur en cours...");
           try {
              const refundId = crypto.randomUUID();
              await initiatePawaPayPayout(refundId, cancelTx.base_amount, cancelTx.buyer_phone);
              await supabase.from("transactions").update({ status: "REFUNDED" }).eq("id", cancelTx.id);
              
              await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
              await sendWhatsAppText(phone, "☑️ Dossier clos. Tapez BONJOUR pour revenir au menu.");
              
              await sendWhatsAppText(cancelTx.buyer_phone, `✅ Le vendeur a accepté l'annulation. Un remboursement de ${cancelTx.base_amount} $ a été envoyé sur votre compte Mobile Money.`);
           } catch (error) {
              console.error("Refund Error:", error);
              await sendWhatsAppText(phone, "❌ Erreur technique lors du remboursement. Le support a été alerté.");
           }
        } else if (cleanText === "CMD_LITIGE" || cleanText.toUpperCase() === "REFUSER") {
           await supabase.from("transactions").update({ status: "DISPUTED" }).eq("id", cancelTx.id);
           await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", phone);
           await sendWhatsAppText(phone, "🚨 La transaction a été bloquée et signalée en litige. Notre équipe de support vous contactera sous peu. Tapez BONJOUR pour revenir au menu.");
           
           await sendWhatsAppText(cancelTx.buyer_phone, "🚨 Le vendeur a refusé l'annulation (indiquant que l'article a été livré). La transaction est gelée et notre support va vous contacter.");
        } else {
           await sendWhatsAppText(phone, "Veuillez cliquer sur ACCEPTER ou REFUSER (LITIGE).");
        }
        break;
      }

      case "AWAITING_DELIVERY_BUYER":
        await sendWhatsAppText(phone, "⏳ En attente de la livraison. Ne remettez votre code secret au vendeur QUE lorsque vous avez reçu l'article.");
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

  await sendWhatsAppText(tx.seller_phone, MESSAGES.CONTRACT_ACCEPTED_SELLER_NOTIFIED);

  if (session.current_state === "INVITED_SELLER") {
    await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", tx.seller_phone);
  }

  await supabase.from("sessions").update({ current_state: "AWAITING_PAYMENT_BUYER", draft_transaction_id: tx.id }).eq("phone_number", tx.buyer_phone);
  await sendWhatsAppButtons(tx.buyer_phone, MESSAGES.PRE_PAYMENT_BUYER, [{ id: "CMD_PAYER", title: "PAYER MAINTENANT" }, { id: "CMD_ANNULER", title: "ANNULER" }, { id: "CMD_AIDE", title: "AIDE" }]);
}