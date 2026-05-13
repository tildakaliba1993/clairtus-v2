// supabase/functions/_shared/pawapayClient.ts

export async function initiatePawaPayDeposit(depositId: string, phone: string, amount: number, currency: string) {
  const jwt = Deno.env.get("PAWAPAY_JWT");
  if (!jwt) throw new Error("Missing PAWAPAY_JWT in Supabase Vault");

  const cleanPhone = phone.replace(/\+/g, '').replace(/\s/g, '');
  let correspondent = "VODACOM_MPESA_COD";

  if (cleanPhone.startsWith("24399") || cleanPhone.startsWith("24397")) correspondent = "AIRTEL_OAPI_COD";
  else if (cleanPhone.startsWith("24384") || cleanPhone.startsWith("24385") || cleanPhone.startsWith("24389")) correspondent = "ORANGE_COD";
  else if (cleanPhone.startsWith("24390")) correspondent = "AFRICELL_COD";

  const payload = {
      depositId: depositId, 
      amount: amount.toString(), 
      currency: currency, // 🚀 DYNAMIC CURRENCY
      country: "COD",
      correspondent: correspondent,
      payer: { type: "MSISDN", address: { value: cleanPhone } },
      customerTimestamp: new Date().toISOString(),
      statementDescription: "Clairtus Sequestre"
  };

  console.log(`[PawaPay] Sending Deposit Request for ${cleanPhone} (${amount} ${currency}) via ${correspondent}`);

  const response = await fetch("https://api.pawapay.cloud/v1/deposits", {
      method: "POST", 
      headers: { "Authorization": `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
  });

  const responseText = await response.text();
  console.log(`[PawaPay] Raw Response Status: ${response.status}`);
  
  if (!response.ok) {
      throw new Error(`PawaPay API Error: ${response.status} - ${responseText}`);
  }

  const result = JSON.parse(responseText);
  if (result.status === "REJECTED") {
      throw new Error(`PawaPay Rejected Deposit: ${result.rejectionReason?.rejectionMessage}`);
  }

  return result;
}

export async function initiatePawaPayPayout(payoutId: string, phone: string, amount: number, currency: string) {
  const jwt = Deno.env.get("PAWAPAY_JWT");
  if (!jwt) throw new Error("Missing PAWAPAY_JWT in Supabase Vault");

  const cleanPhone = phone.replace(/\+/g, '').replace(/\s/g, '');
  let correspondent = "VODACOM_MPESA_COD";

  if (cleanPhone.startsWith("24399") || cleanPhone.startsWith("24397")) correspondent = "AIRTEL_OAPI_COD";
  else if (cleanPhone.startsWith("24384") || cleanPhone.startsWith("24385") || cleanPhone.startsWith("24389")) correspondent = "ORANGE_COD";
  else if (cleanPhone.startsWith("24390")) correspondent = "AFRICELL_COD";

  const payload = {
      payoutId: payoutId, 
      amount: amount.toString(), 
      currency: currency, // 🚀 DYNAMIC CURRENCY
      country: "COD",
      correspondent: correspondent,
      recipient: { type: "MSISDN", address: { value: cleanPhone } },
      customerTimestamp: new Date().toISOString(), 
      statementDescription: "Paiement Clairtus" 
  };

  console.log(`[PawaPay] Sending Payout Request for ${cleanPhone} (${amount} ${currency}) via ${correspondent}`);

  const response = await fetch("https://api.pawapay.cloud/v1/payouts", {
      method: "POST", 
      headers: { "Authorization": `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
  });

  const responseText = await response.text();
  console.log(`[PawaPay] Raw Payout Response Status: ${response.status}`);
  
  if (!response.ok) {
      throw new Error(`PawaPay API Error: ${response.status} - ${responseText}`);
  }

  const result = JSON.parse(responseText);
  if (result.status === "REJECTED") {
      throw new Error(`PawaPay Rejected Payout: ${result.rejectionReason?.rejectionMessage}`);
  }

  return result;
}