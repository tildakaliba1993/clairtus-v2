/**
 * Korapay END-TO-END escrow demo (single uninterrupted run, sandbox).
 *
 * Drives one escrow reference through the full hold→release lifecycle and proves it
 * with balance deltas — no dashboard clicks:
 *   1. read balance
 *   2. FUND: create a bank-transfer charge (buyer pays into a temp virtual account)
 *   3. funds LAND in our Korapay Balance — triggered instantly via the Sandbox Credit
 *      API, with the sandbox's ~2-min auto-complete as a reliable fallback (we poll
 *      the charge until `success`)
 *   4. RELEASE: disburse the collected funds from balance on our trigger (the seller payout)
 *   5. confirm the balance rose on funding and fell on release
 *
 * Run:  node --experimental-strip-types packages/payments/scripts/korapay-escrow-demo.ts
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

const CURRENCY = 'NGN';
const FUND_AMOUNT = 5000; // ₦5,000 buyer pay-in
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

const avail = async () => {
  const r = await call('GET', '/merchant/api/v1/balances');
  return Number(r.json?.data?.[CURRENCY]?.available_balance ?? NaN);
};

const fmt = (n: number) => `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
function step(n: string) { console.log(`\n──────────── ${n}`); }

async function main() {
  const escrowRef = `escrow-demo-${Date.now()}`;
  console.log('=== Korapay end-to-end escrow demo (sandbox) ===');
  console.log(`escrow reference: ${escrowRef}  currency: ${CURRENCY}`);

  // 1) Balance before anything.
  const bal0 = await avail();
  step(`1. Balance before: ${fmt(bal0)}`);

  // 2) FUND — buyer initiates a bank-transfer charge into a temporary virtual account.
  step('2. FUND — create bank-transfer charge (auto_complete:false so WE control settlement)');
  const charge = await call('POST', '/merchant/api/v1/charges/bank-transfer', {
    reference: escrowRef,
    amount: FUND_AMOUNT,
    currency: CURRENCY,
    auto_complete: false,
    customer: { name: 'Demo Buyer', email: 'demo-buyer@example.com' },
  });
  if (!charge.ok || charge.json?.status !== true) {
    throw new Error(`charge failed: HTTP ${charge.status} ${JSON.stringify(charge.json)}`);
  }
  const vba = charge.json.data.bank_account;
  console.log(`   temp virtual account: ${vba.account_number} (${vba.bank_name}), status=${charge.json.data.status}`);

  // 3) FUNDS LAND — trigger the inbound payment now (Sandbox Credit API). Best-effort;
  //    if the endpoint shape differs, the sandbox auto-completes within ~2 min and the poll below catches it.
  step('3. Simulate the buyer paying (Sandbox Credit API), then wait for the charge to settle into balance');
  const credit = await call('POST', '/merchant/api/v1/virtual-bank-account/sandbox/credit', {
    account_number: vba.account_number,
    amount: FUND_AMOUNT,
    currency: CURRENCY,
  });
  console.log(`   sandbox credit trigger: HTTP ${credit.status} ${credit.json?.message ?? credit.json?.error ?? ''}`);

  let chargeStatus = 'processing';
  for (let i = 0; i < 18 && chargeStatus !== 'success' && chargeStatus !== 'failed'; i++) {
    await sleep(10_000);
    const s = await call('GET', `/merchant/api/v1/charges/${escrowRef}`);
    chargeStatus = (s.json?.data?.status ?? 'processing').toLowerCase();
    process.stdout.write(`   [${(i + 1) * 10}s] charge status: ${chargeStatus}\n`);
  }
  if (chargeStatus !== 'success') throw new Error(`pay-in did not settle (status=${chargeStatus})`);

  const bal1 = await avail();
  const credited = Number((bal1 - bal0).toFixed(2));
  step(`✓ FUNDED — funds now HELD in our Korapay Balance. ${fmt(bal0)} → ${fmt(bal1)}  (credited net ${fmt(credited)})`);

  // 4) RELEASE — on OUR trigger, disburse the held funds from balance to the seller.
  const releaseAmount = Math.max(1000, Math.floor(credited)); // ≥ ₦1,000 min; release the collected net
  step(`4. RELEASE — disburse ${fmt(releaseAmount)} from balance to the seller (our trigger)`);
  const payoutRef = `${escrowRef}-release`;
  const payout = await call('POST', '/merchant/api/v1/transactions/disburse', {
    reference: payoutRef,
    destination: {
      type: 'bank_account',
      amount: releaseAmount,
      currency: CURRENCY,
      narration: `Release of ${escrowRef}`,
      bank_account: { bank: '033', account: '0000000000' }, // sandbox SUCCESS payout account
      customer: { name: 'Demo Seller', email: 'demo-seller@example.com' },
    },
  });
  if (!payout.ok || payout.json?.status !== true) {
    throw new Error(`disburse failed: HTTP ${payout.status} ${JSON.stringify(payout.json)}`);
  }
  console.log(`   disburse: HTTP ${payout.status}, status=${payout.json.data.status}, fee=${payout.json.data.fee}`);

  const bal2 = await avail();
  step(`✓ RELEASED — funds left the balance on our trigger. ${fmt(bal1)} → ${fmt(bal2)}  (released+fee ${fmt(Number((bal1 - bal2).toFixed(2)))})`);

  // 5) Verdict.
  const funded = bal1 > bal0;
  const released = bal2 < bal1;
  console.log('\n=========================================================');
  console.log(`ESCROW ${escrowRef}`);
  console.log(`  fund (held):   ${fmt(bal0)} → ${fmt(bal1)}   ${funded ? '✓ funds rested in balance' : '✗'}`);
  console.log(`  release (out): ${fmt(bal1)} → ${fmt(bal2)}   ${released ? '✓ released on our trigger' : '✗'}`);
  console.log(`  RESULT: ${funded && released ? '✅ FULL hold→release lifecycle PROVEN end-to-end on Korapay sandbox' : '❌ INCOMPLETE — inspect output above'}`);
  console.log('=========================================================');
  if (!(funded && released)) process.exit(1);
}

main().catch((e) => { console.error('\nDEMO FAILED:', e.message ?? e); process.exit(1); });
