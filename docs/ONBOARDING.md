# Design-Partner Onboarding Runbook

How we take a South African design partner from outreach to a live escrow pilot. The path is
**outreach → sandbox integration → pilot (live)**. Until self-serve signup exists, onboarding is
manual and runs through `onboardTenant()` (`apps/b2b-api/src/onboarding/onboard.ts`).

## 0. Before you start
- Confirm the partner's market (currently **ZA**), expected flow (collect → hold → release → payout),
  and their webhook receiver URL.
- Have a production `SqlExecutor` wired for the API (carry-forward #1) — onboarding writes to the tenants table.

## 1. Create the tenant + keys (one call)

```ts
import { Tenancy } from '@clairtus/tenancy';
import { WebhookService } from './webhooks/webhook.service';
import { onboardTenant } from './onboarding/onboard';

const result = await onboardTenant(
  { tenancy: new Tenancy(sql), webhooks: new WebhookService(sql, fetch) },
  {
    name: 'Acme SA',
    country: 'ZA',
    webhookUrl: 'https://acme.example/webhooks/clairtus',
    // scopes defaults to ['escrows:write','payouts:write','kyc:write']
  } satisfies PartnerConfig,
);
// → { tenantId, testKey: 'ck_test_…', liveKey: 'ck_live_…', webhook: { signingSecret: 'whsec_…' } }
```

Share with the partner **securely** (password manager / one-time link, never email/Slack in plaintext):
- the **test key** (`ck_test_…`) now,
- the **webhook signing secret** (`whsec_…`),
- the **liveKey** only after the go-live checklist below. Store our copy hashed (it already is).

## 2. Per-partner config

| Field | Meaning | MVP default |
|---|---|---|
| `name` / `country` | Tenant identity + market | — / `ZA` |
| `scopes` | API-key scopes | `escrows:write`, `payouts:write`, `kyc:write` |
| `webhookUrl` | Their signed-event receiver | optional |
| KYC release threshold | Release amount requiring a VERIFIED seller | `KYC_RELEASE_THRESHOLD` env (default R10,000) |
| Enabled rails | Live payout rails (per market) | Korapay (ZA), simulated (sandbox) |

## 3. Sandbox integration (partner)
Point them at **`docs/QUICKSTART.md`** and the live OpenAPI at **`/docs`**. They build against the
`ck_test_…` key — payouts run on the deterministic **simulated rail** (no real money), driveable via
`metadata.simulate` (`succeeded`/`failed`/`pending`).

**Sandbox sign-off checklist** (have them demonstrate):
- [ ] Create escrow → fund → release → payout; balances reconcile.
- [ ] Receive a webhook and **verify its signature** (`verifyWebhookSignature`).
- [ ] Handle a failed payout (`simulate: 'failed'`) and a 409/422 error envelope.
- [ ] (If applicable) start a KYC check and gate a high-value release.

## 4. Go-live checklist (before issuing the live key)
- [ ] **Postgres adapter** wired + migrations applied (carry-forward #1).
- [ ] **Korapay**: live keys configured; **static egress IP whitelisted in Live mode** (E2/T2.3);
      custody (b) no-auto-sweep + (d) segregation confirmed in writing.
- [ ] **Smile ID** live credentials configured (`KYC_PROVIDER`); callback URL reachable.
- [ ] **Webhook retry worker** running (`WebhookService.processDue` on a cron).
- [ ] Partner's webhook endpoint verified in production; correlation/log monitoring on.
- [ ] Per-market limits + KYC threshold reviewed with compliance.

## 5. Pilot
Issue the `ck_live_…` key, start with a low per-transaction cap, and watch the first live escrows
(dashboard + structured logs by `X-Request-Id`). Graduate the cap as confidence builds.

> **MVP "done" (per IMPLEMENTATION_PLAN):** ≥1 SA design partner live in sandbox; ≥1 pilot processing
> live escrows. These are operational milestones owned by the co-founder's outreach track.
