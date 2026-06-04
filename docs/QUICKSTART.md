# Clairtus B2B API — Quickstart

The Clairtus Escrow API lets your platform hold a buyer's funds and release them to a seller
only when your release condition is met. This guide runs a full escrow end-to-end in **sandbox**
(no real money) using the TypeScript SDK.

> **Sandbox vs production:** use a **`ck_test_…`** key for sandbox (payouts run through a
> deterministic *simulated* rail) and a **`ck_live_…`** key for production (real rails). The code
> is identical — only the key differs.

## 1. Install

```bash
pnpm add @clairtus/sdk
```

## 2. Initialise the client

```ts
import { ClairtusClient } from '@clairtus/sdk';

const clairtus = new ClairtusClient({
  baseUrl: 'https://api.clairtus.example/v1',
  apiKey: process.env.CLAIRTUS_API_KEY!, // ck_test_… in sandbox
});
```

## 3. Run an escrow: create → fund → release → pay out

```ts
// A party is a buyer/seller/beneficiary on your platform.
const seller = await clairtus.parties.create({ role: 'seller', name: 'Sue', accountRef: '0000000000', bankCode: '033' });

// Amounts are integer MINOR units (e.g. 100000 = R1,000.00). feeBps 150 = 1.5%.
const escrow = await clairtus.escrows.create({
  baseAmount: 100000,
  currency: 'ZAR',
  feeBps: 150,
  feeResponsibility: 'SELLER',
  sellerPartyId: seller.id,
});

// Fund the escrow (buyer's money is now HELD). Idempotency-Key makes retries safe.
await clairtus.escrows.fund(escrow.id, { idempotencyKey: `fund-${escrow.id}` });

// Release when your condition is met (delivery confirmed, etc.).
await clairtus.escrows.release(escrow.id);

// Pay the seller out from their released balance.
const payout = await clairtus.payouts.create({ escrowId: escrow.id, recipientPartyId: seller.id, amount: 98500 });
// → { status: 'succeeded', rail: 'simulated', ... } in sandbox

// Inspect money at any time.
const balances = await clairtus.balances();
```

In sandbox you can force a payout outcome:

```ts
await clairtus.payouts.create({ escrowId: escrow.id, recipientPartyId: seller.id, amount: 98500, metadata: { simulate: 'failed' } });
```

## 4. Receive & verify webhooks

Register an endpoint, then verify each delivery's signature with the **raw** request body:

```ts
const { signingSecret } = await clairtus.webhookEndpoints.create({ url: 'https://yourapp.com/webhooks/clairtus' });

// In your webhook handler:
import { verifyWebhookSignature } from '@clairtus/sdk';

app.post('/webhooks/clairtus', (req, res) => {
  const ok = verifyWebhookSignature(signingSecret, req.rawBody, req.headers['x-clairtus-signature']);
  if (!ok) return res.status(401).end();
  const event = JSON.parse(req.rawBody); // { id, type, escrowId, data, createdAt }
  // event.type ∈ escrow.funded | escrow.released | escrow.refunded | escrow.cancelled |
  //              escrow.disputed | payout.succeeded | payout.failed | kyc.completed
  res.status(200).end();
});
```

## 5. KYC (higher-ticket releases)

Releases above the configured threshold require a **VERIFIED** seller:

```ts
const check = await clairtus.kyc.createCheck({ partyId: seller.id, level: 'biometric' });
// Hand check.token to the Smile ID client SDK; the result arrives on your webhook as kyc.completed.
```

## Auth, scopes, idempotency & validation

- **API keys** are `Bearer` tokens (`ck_test_…` sandbox, `ck_live_…` production). Read endpoints need
  only a valid key; **write endpoints require a scope**: `escrows:write`, `parties:write`,
  `payouts:write`, `kyc:write`. A key missing the scope gets **403**. (Onboarding issues keys with the
  full write set; narrower keys are available on request.)
- **Idempotency is required** on money-moving POSTs — `fund`, `release`, `refund`, and `payouts.create`.
  Send an `Idempotency-Key`; the SDK **auto-generates one per call** if you don't, and reuse your own
  across manual retries (`{ idempotencyKey }`). A missing key on these routes returns **400**.
- **Validation:** malformed/unknown/over-range fields are rejected with **422** before anything runs.
- **Rate limiting:** requests are throttled per API key; over the limit returns **429** (back off + retry).
- **Compliance limits:** escrow `create` is checked against your market's per-transaction and rolling
  daily/monthly limits; an out-of-bounds amount returns **422**. Higher-ticket **release** requires a
  KYC-**VERIFIED** seller above the market's tier (else **403**).

## Errors

Every non-2xx response throws a `ClairtusApiError` with `{ status, code, message }` — e.g. releasing
before funding throws `{ status: 409, code: 'conflict' }`. All errors share the envelope
`{ "error": { "code", "message", "statusCode" } }`. Common codes: `unauthorized` (401),
`forbidden` (403, missing scope), `bad_request` (400, e.g. missing Idempotency-Key),
`unprocessable_entity` (422, validation), `too_many_requests` (429), `conflict` (409).

## Full API reference

Interactive OpenAPI docs are served at **`/docs`** (OpenAPI JSON at `/docs-json`).
