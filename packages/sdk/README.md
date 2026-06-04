# @clairtus/sdk

Typed TypeScript client for the **Clairtus B2B Escrow API** — create escrows, fund, release/refund,
pay out from balance, manage parties, run KYC, and verify webhooks. Framework-free (inject any `fetch`).

## Install

```bash
npm install @clairtus/sdk
```

## Quickstart

```ts
import { ClairtusClient } from '@clairtus/sdk';

const clairtus = new ClairtusClient({
  baseUrl: 'https://api.clairtus.com/v1',
  apiKey: process.env.CLAIRTUS_API_KEY!, // ck_test_… (sandbox) or ck_live_… (production)
});

const seller = await clairtus.parties.create({ role: 'seller', accountRef: '0000000000', bankCode: '033' });
const escrow = await clairtus.escrows.create({
  baseAmount: 100000, // R1000.00 in minor units
  currency: 'ZAR',
  feeBps: 150,
  feeResponsibility: 'SELLER',
  sellerPartyId: seller.id,
});

await clairtus.escrows.fund(escrow.id);    // Idempotency-Key auto-generated for money POSTs
await clairtus.escrows.release(escrow.id);
const payout = await clairtus.payouts.create({ escrowId: escrow.id, recipientPartyId: seller.id, amount: 98500 });
```

## Notes

- **Scopes:** write calls need the matching key scope (`escrows:write`, `parties:write`, `payouts:write`, `kyc:write`).
- **Idempotency:** `fund` / `release` / `refund` / `payouts.create` are money-moving — the SDK auto-sends a per-call
  `Idempotency-Key`. Pass your own (`{ idempotencyKey }`) to make a manual retry idempotent.
- **Pagination:** `escrows.list`, `payouts.list`, and `ledger` accept `{ limit, cursor }` and return
  `{ data, nextCursor }`; pass `nextCursor` back as `cursor` for the next page.
- **Errors:** non-2xx throws `ClairtusApiError` with `{ status, code, message }`.
- **Webhooks:** verify inbound signatures with `verifyWebhookSignature(body, signature, secret)`.

Full reference: <https://developers.clairtus.com> · interactive OpenAPI at the API's `/docs`.
