// supabase/functions/_shared/whatsappClient.ts

const WHATSAPP_API_URL = `https://graph.facebook.com/v22.0/${Deno.env.get("WHATSAPP_PHONE_ID")}/messages`;
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN");

export async function sendWhatsAppText(to: string, text: string) {
    try {
        console.log(`[WhatsApp API] Attempting to send free-form text to ${to}...`);
        
        const payload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "text",
            text: { body: text }
        };

        const response = await fetch(WHATSAPP_API_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        
        // 🚨 Check for Meta's specific "Outside 24-hour window" error
        if (data.error && data.error.code === 131047) {
            console.warn(`⚠️ [WhatsApp API] 24h window closed for ${to}. Falling back to utility template.`);
            return await sendWhatsAppTemplate(to, "clairtus_update", ["Mise à jour de votre transaction.", "Ouvrez ce message pour actualiser votre session."]);
        }
        
        if (!response.ok) throw new Error(`WhatsApp API Error: ${response.statusText}`);
        
        console.log(`✅ [WhatsApp API] Text sent successfully to ${to}`);
        return data;
    } catch (error) {
        console.error(`🚨 [WhatsApp API] Critical Error sending text to ${to}:`, error);
        throw error;
    }
}

export async function sendWhatsAppButtons(to: string, bodyText: string, buttons: { id: string, title: string }[]) {
    try {
        const payload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "interactive",
            interactive: {
                type: "button",
                body: { text: bodyText },
                action: { buttons: buttons.map(b => ({ type: "reply", reply: { id: b.id, title: b.title } })) }
            }
        };

        const response = await fetch(WHATSAPP_API_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        
        // 🚨 Check for Meta's specific "Outside 24-hour window" error
        if (data.error && data.error.code === 131047) {
             console.warn(`⚠️ [WhatsApp API] 24h window closed for buttons to ${to}. Falling back to template.`);
             return await sendWhatsAppTemplate(to, "clairtus_update", ["Mise à jour requise.", "Répondez BONJOUR pour continuer."]);
        }

        if (!response.ok) throw new Error(`WhatsApp API Error: ${response.statusText}`);
        return data;
    } catch (error) {
        console.error(`🚨 [WhatsApp API] Critical Error sending buttons to ${to}:`, error);
        throw error;
    }
}

export async function sendWhatsAppTemplate(to: string, templateName: string, textVariables: string[]) {
    try {
        const parameters = textVariables.map(text => ({ type: "text", text: text }));
        const payload = {
            messaging_product: "whatsapp",
            to: to,
            type: "template",
            template: { name: templateName, language: { code: "fr" }, components: [{ type: "body", parameters: parameters }] }
        };

        const response = await fetch(WHATSAPP_API_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok) {
            console.error(`❌ [WhatsApp API] Failed to send template:`, JSON.stringify(data));
            throw new Error(`WhatsApp API Error: ${response.statusText}`);
        }
        console.log(`✅ [WhatsApp API] Template sent successfully to ${to}`);
        return data;
    } catch (error) {
         console.error(`🚨 [WhatsApp API] Critical Error sending template to ${to}:`, error);
         throw error;
    }
}

// Add this at the bottom of whatsappClient.ts
export async function sendWhatsAppImage(to: string, mediaId: string, caption: string = "") {
    const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN");
    const WHATSAPP_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_ID");

    const response = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "image",
            image: {
                id: mediaId,
                caption: caption
            }
        }),
    });

    if (!response.ok) {
        const errorData = await response.text();
        console.error("❌ Error sending image via WhatsApp API:", errorData);
    }
}

export async function processAndStoreKYC(mediaId: string, phone: string, supabase: any) {
    const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN");
    
    // 1. Ask Meta for the temporary download URL
    const res = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
        headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}` }
    });
    const mediaData = await res.json();
    
    if (!mediaData.url) throw new Error("Could not get media URL from Meta");

    // 2. Download the actual binary file from Meta
    const fileRes = await fetch(mediaData.url, {
        headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}` }
    });
    const blob = await fileRes.blob();

    // 3. Upload the file to your Supabase Storage bucket
    const fileExt = mediaData.mime_type.split('/')[1] || 'jpeg';
    const fileName = `${phone}_${Date.now()}.${fileExt}`;
    
    const { data, error } = await supabase.storage
        .from('kyc-documents')
        .upload(fileName, blob, {
            contentType: mediaData.mime_type,
            upsert: true
        });

    if (error) {
        console.error("Storage Upload Error:", error);
        throw error;
    }

    // 4. Generate the permanent Public URL to view it
    const { data: publicUrlData } = supabase.storage
        .from('kyc-documents')
        .getPublicUrl(fileName);

    return publicUrlData.publicUrl;
}