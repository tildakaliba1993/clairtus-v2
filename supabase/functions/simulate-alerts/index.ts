import { notifyAdmin } from "../_shared/adminAlerts.ts";

Deno.serve(async (req: Request) => {
    // 🛡️ SECURITY CHECK: Only Admins can hit this
    const authHeader = req.headers.get('Authorization');
    const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET");
    
    if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
        return new Response("Unauthorized", { status: 401 });
    }

    try {
        console.log("🧪 [TEST] Simulating Admin Alerts...");

        const mockPhone = "243810000000";
        const mockTxId = crypto.randomUUID();

        // Simulate 1: Successful Deposit
        await notifyAdmin("SUCCESS_DEPOSIT", "Un dépôt de 50 USD a été sécurisé !", mockPhone, mockTxId);
        
        // Wait 2 seconds
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Simulate 2: Help Needed
        await notifyAdmin("HELP_NEEDED", "Un utilisateur demande de l'aide sur une invitation.", mockPhone, mockTxId);

        // Wait 2 seconds
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Simulate 3: Dispute Triggered
        await notifyAdmin("DISPUTE", "Le vendeur a saisi un code PIN incorrect 3 fois de suite. Fonds gelés pour suspicion de fraude.", mockPhone, mockTxId);

        return new Response(JSON.stringify({ success: true, message: "Test alerts dispatched to WhatsApp and Database" }), { 
            status: 200, 
            headers: { "Content-Type": "application/json" } 
        });

    } catch (error) {
        console.error("🚨 [TEST ERROR]:", error);
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { 
            status: 500, 
            headers: { "Content-Type": "application/json" } 
        });
    }
});