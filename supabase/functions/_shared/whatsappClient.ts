// supabase/functions/_shared/whatsappClient.ts

export async function sendWhatsAppText(to: string, bodyText: string) {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_ID");

  if (!token || !phoneId) throw new Error("Missing WhatsApp credentials in Supabase Vault.");

  const payload = { messaging_product: "whatsapp", to: to, type: "text", text: { body: bodyText } };

  const response = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  
  const result = await response.json();
  console.log(`[Meta Raw Text Response for ${to}]:`, JSON.stringify(result));
  if (result.error) console.error("❌ Meta API Error (Text):", JSON.stringify(result.error));
  return result;
}

export async function sendWhatsAppButtons(to: string, bodyText: string, buttons: { id: string, title: string }[]) {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_ID");

  if (!token || !phoneId) throw new Error("Missing WhatsApp credentials in Supabase Vault.");

  const payload = {
    messaging_product: "whatsapp", to: to, type: "interactive",
    interactive: {
      type: "button", body: { text: bodyText },
      action: { buttons: buttons.map(btn => ({ type: "reply", reply: { id: btn.id, title: btn.title } })) }
    }
  };

  const response = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  
  const result = await response.json();
  console.log(`[Meta Raw Button Response for ${to}]:`, JSON.stringify(result));
  if (result.error) console.error("❌ Meta API Error (Buttons):", JSON.stringify(result.error));
  return result;
}

export async function sendWhatsAppTemplate(to: string, templateName: string, bodyVariables: string[]) {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_ID");

  if (!token || !phoneId) throw new Error("Missing WhatsApp credentials in Supabase Vault.");

  const payload = {
    messaging_product: "whatsapp", to: to, type: "template",
    template: {
      name: templateName, language: { code: "fr" },
      components: [ { type: "body", parameters: bodyVariables.map(val => ({ type: "text", text: String(val) })) } ]
    }
  };

  const response = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  
  const result = await response.json();
  console.log(`[Meta Raw Template Response for ${to}]:`, JSON.stringify(result));
  if (result.error) console.error("❌ Meta API Error (Template):", JSON.stringify(result.error));
  return result;
}