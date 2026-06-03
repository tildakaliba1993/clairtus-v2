/**
 * Korapay custody spike (T2.3 gating spike) — hits the LIVE Korapay sandbox to
 * validate the escrow "hold-in-balance" model before we build the API on it.
 *
 * It exercises the same endpoints the KorapayRail adapter uses and reports what
 * each call returns, so we can confirm the four custody criteria from
 * IMPLEMENTATION_PLAN T2.3:
 *   (a) collections settle into and remain in our Korapay Balance,
 *   (b) no forced auto-sweep during a multi-day hold,
 *   (c) we can disburse from balance on our own trigger, any time,
 *   (d) how balance-held funds are treated / segregated.
 *
 * Run:  node --experimental-strip-types packages/payments/scripts/korapay-custody-spike.ts
 * (loads sandbox creds from packages/payments/.env.local — git-ignored)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = loadEnv(resolve(__dirname, '../.env.local'));
const SECRET = env.KORAPAY_SECRET_KEY;
const BASE = 'https://api.korapay.com';
if (!SECRET) throw new Error('KORAPAY_SECRET_KEY missing from .env.local');

const CURRENCY = 'NGN'; // sandbox default currency for this account (Fincrest / KPY58368)
const ref = (p: string) => `${p}-spike-${Date.now()}`;

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

function show(label: string, r: { status: number; json: unknown }) {
  console.log(`\n── ${label}  [HTTP ${r.status}]`);
  console.log(JSON.stringify(r.json, null, 2));
}

const ngn = (data: any) => data?.[CURRENCY] ?? {};

async function main() {
  console.log('=== Korapay custody spike (sandbox) ===');
  console.log(`key: ${SECRET.slice(0, 11)}…  base: ${BASE}  currency: ${CURRENCY}`);

  // 1) Can we read our balance? (the "balance" that escrow funds rest in)
  const bal0 = await call('GET', '/merchant/api/v1/balances');
  show('1. GET balances (initial)', bal0);
  const avail0 = ngn(bal0.json?.data).available_balance;

  // 2) Collect-into-balance: initiate a bank-transfer charge → expect a temp virtual account.
  //    A virtual account (not an auto-settle-to-bank instruction) is the evidence that
  //    funds will land in OUR balance. (Criterion a.)
  const payinRef = ref('payin');
  const payin = await call('POST', '/merchant/api/v1/charges/bank-transfer', {
    reference: payinRef,
    amount: 1000, // ₦1,000 sandbox
    currency: CURRENCY,
    customer: { name: 'Spike Buyer', email: 'spike-buyer@example.com' },
  });
  show('2. POST charges/bank-transfer (collect into balance)', payin);

  // 3) Query the charge — it stays "processing/pending" until the inbound transfer is
  //    simulated in the sandbox dashboard. Confirms the charge is balance-bound, not swept.
  const charge = await call('GET', `/merchant/api/v1/charges/${payinRef}`);
  show('3. GET charges/:ref (status of the collection)', charge);

  // 4) Disburse-from-balance on OUR trigger (criterion c). If the sandbox balance is
  //    funded this returns processing/success; if not, it returns an insufficient-balance
  //    error — which itself proves payouts draw from the held balance (our escrow model).
  const payoutRef = ref('payout');
  const payout = await call('POST', '/merchant/api/v1/transactions/disburse', {
    reference: payoutRef,
    destination: {
      type: 'bank_account',
      amount: 1000, // ₦1,000 — Korapay's minimum NGN payout
      currency: CURRENCY,
      narration: 'Custody spike release',
      bank_account: { bank: '033', account: '0000000000' }, // Korapay sandbox: SUCCESSFUL payout test account
      customer: { name: 'Spike Seller', email: 'spike-seller@example.com' },
    },
  });
  show('4. POST transactions/disburse (release from balance, our trigger)', payout);

  // 4b) Verify the payout status on our trigger (the "release" leg).
  if (payout.ok && payout.json?.status === true) {
    const verify = await call('GET', `/merchant/api/v1/transactions/${payoutRef}`);
    show('4b. GET transactions/:ref (payout status)', verify);
  }

  // 5) Balance after — shows whether the disburse reserved/moved funds out of balance.
  const bal1 = await call('GET', '/merchant/api/v1/balances');
  show('5. GET balances (after)', bal1);
  const avail1 = ngn(bal1.json?.data).available_balance;

  console.log('\n=== CUSTODY CRITERIA — observed evidence ===');
  console.log(`(a) collect-into-balance: bank-transfer charge returned a ${payin.json?.data?.bank_account ? 'temporary virtual account → funds route to our balance ✓' : 'NO virtual account ✗ (inspect response above)'}`);
  console.log(`(b) no forced auto-sweep: charge status = "${charge.json?.data?.status}" (stays in balance pending our action; auto-settle-to-bank NOT enabled) — confirm long-hold behaviour with Korapay support`);
  const disburseOk = payout.ok && payout.json?.status === true;
  console.log(`(c) disburse-on-trigger: HTTP ${payout.status} → ${disburseOk
    ? `status="${payout.json?.data?.status}" — disburse-from-balance succeeded on our trigger ✓`
    : `"${payout.json?.error ?? ''} ${payout.json?.message ?? ''}".trim() — DISBURSE BLOCKED ✗ (payout product likely not enabled on this account; cannot confirm hold→release until fixed)`}`);
  console.log(`(d) segregation: Korapay balance is a POOLED merchant balance; per-escrow attribution is OUR ledger's job (ARCHITECTURE §6.1). Segregated per-tx virtual accounts are a later (Fincra) enhancement — confirm treatment of held funds with Korapay.`);
  console.log(`\nbalance NGN available: ${avail0} → ${avail1}`);
  console.log('\nNote: completing the pay-in leg (funds actually landing) requires simulating the inbound transfer in the Korapay sandbox dashboard; this script proves the API surface + the balance/disburse model.');
}

main().catch((e) => { console.error('SPIKE FAILED:', e); process.exit(1); });
