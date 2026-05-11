// supabase/functions/test-whatsapp/index.ts
import { sendWhatsAppText } from "../_shared/whatsappClient.ts";

Deno.serve(async (req: Request) => {
  try {
    // ⚠️ Hardcoded to your South African test number
    const TO_NUMBER = "27603960790"; 

    console.log(`Attempting to send live WhatsApp text to ${TO_NUMBER}...`);

    const message = "Bonjour! 🚀 This is Clairtus V2 speaking directly from our official +243 number!";

    const result = await sendWhatsAppText(TO_NUMBER, message);

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});