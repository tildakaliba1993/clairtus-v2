/**
 * Seed demo data on the LIVE API via the SDK (sandbox / simulated rail), so the dashboard
 * shows real money flows. Run with your test key:
 *   CLAIRTUS_API_KEY=ck_test_… pnpm --filter @clairtus/b2b-api demo
 * (CLAIRTUS_API_URL defaults to the Fly app.)
 */
import { ClairtusClient } from '@clairtus/sdk';

const baseUrl = process.env.CLAIRTUS_API_URL ?? 'https://clairtus-api.fly.dev/v1';
const apiKey = process.env.CLAIRTUS_API_KEY;
if (!apiKey) {
  console.error('CLAIRTUS_API_KEY is required (your ck_test_… key)');
  process.exit(1);
}
const sdk = new ClairtusClient({ baseUrl, apiKey });

async function main(): Promise<void> {
  const seller = (await sdk.parties.create({ role: 'seller', name: 'Demo Seller', accountRef: '0000000000', bankCode: '033' })) as any;
  const buyer = (await sdk.parties.create({ role: 'buyer', name: 'Demo Buyer' })) as any;

  // Escrow A — full lifecycle: create → fund → release → payout (simulated rail).
  const a = (await sdk.escrows.create({ baseAmount: 100000, currency: 'ZAR', feeBps: 150, feeResponsibility: 'SELLER', buyerPartyId: buyer.id, sellerPartyId: seller.id })) as any;
  await sdk.escrows.fund(a.id, { idempotencyKey: `fund-${a.id}` });
  await sdk.escrows.release(a.id);
  const payout = (await sdk.payouts.create({ escrowId: a.id, recipientPartyId: seller.id, amount: 98500 })) as any;
  console.log(`escrow A ${a.id} → RELEASED, payout ${payout.status} via ${payout.rail}`);

  // Escrow B — funded and HELD (so the dashboard shows a non-zero held balance + a FUNDED escrow).
  const b = (await sdk.escrows.create({ baseAmount: 50000, currency: 'ZAR', feeBps: 150, feeResponsibility: 'SELLER', buyerPartyId: buyer.id, sellerPartyId: seller.id })) as any;
  await sdk.escrows.fund(b.id, { idempotencyKey: `fund-${b.id}` });
  console.log(`escrow B ${b.id} → FUNDED (held)`);

  const balances = (await sdk.balances()) as any;
  console.log('\nBalances:', JSON.stringify(balances.data, null, 2));
  console.log('\n✓ Demo data created — refresh the dashboard to see it.');
}

main().catch((e) => { console.error('demo failed:', e?.message ?? e); process.exit(1); });
