// supabase/functions/whatsapp-webhook/index.ts
import { processMessage } from "../_shared/stateMachine.ts";

const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") || "clairtus_secure_token_2026";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === META_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      
      if (body.object === "whatsapp_business_account") {
        for (const entry of body.entry) {
          for (const change of entry.changes) {
            
            // 🚀 NEW: Catching Meta's Silent Delivery Receipts!
            if (change.value && change.value.statuses) {
              for (const status of change.value.statuses) {
                if (status.status === "failed") {
                   console.error(`🚨 [DELIVERY FAILED] To: ${status.recipient_id} | Error:`, JSON.stringify(status.errors));
                } else {
                   console.log(`📫 [DELIVERY STATUS] To: ${status.recipient_id} | Status: ${status.status}`);
                }
              }
            }

            // Processing Incoming Messages
            if (change.value && change.value.messages && change.value.messages.length > 0) {
              const message = change.value.messages[0];
              let messageText = "";

              if (message.type === "text") {
                messageText = message.text.body;
              } else if (message.type === "interactive" && message.interactive.type === "button_reply") {
                messageText = message.interactive.button_reply.id;
              } else if (message.type === "button") {
                messageText = message.button.text;
                if (messageText.toUpperCase() === "ACCEPTER") messageText = "CMD_ACCEPTER";
                if (messageText.toUpperCase() === "REFUSER") messageText = "CMD_REFUSER";
                if (messageText.toUpperCase() === "AIDE") messageText = "CMD_AIDE";
              }

              if (messageText) {
                const senderPhone = message.from;
                console.log(`📩 [WHATSAPP MESSAGE RECEIVED] From: ${senderPhone} | Input: ${messageText}`);
                await processMessage(senderPhone, messageText);
              }
            }
          }
        }
      }

      return new Response("EVENT_RECEIVED", { status: 200 });

    } catch (error) {
      console.error("❌ Error processing webhook:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
});