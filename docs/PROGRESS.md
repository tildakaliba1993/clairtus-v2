# Clairtus — Build Progress & Session Handoff

**Purpose:** lets a fresh session resume with full context. Read this + `PRD.md`,
`ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, then `git log`.

_Last updated: during E2 (T2.3 in progress)._

---

## How to resume in a new session (say this to the assistant)

> "Read `docs/PROGRESS.md`, `docs/ARCHITECTURE.md`, and `docs/IMPLEMENTATION_PLAN.md`.
> We're on branch `claude/e2-payment-rails`, mid E2/T2.3. Continue."

Then the assistant should:
1. `git fetch && git checkout claude/e2-payment-rails` (worktree: `/Users/cash/clairtus-v2/.claude/worktrees/happy-beaver-5b106d`).
2. Install + test with **corepack pnpm** (plain `pnpm` is NOT on PATH in fresh shells):
   `corepack pnpm install` → `corepack pnpm -r --filter "./packages/*" test`.
3. Continue **T2.3 — Korapay adapter** (details below).

## Environment notes (important)
- **Use `corepack pnpm …`** — `pnpm` alone isn't on PATH in non-interactive shells. Node 22, pnpm 10.16.1.
- **No Docker** (team can't run it). Tests use **pglite** (in-process Postgres), vitest, and `deno test`/`deno check`. Never reintroduce Testcontainers.
- Deno 2.7 available (B2C edge functions + B2C bundle verification).

## Tech stack (decided)
TypeScript everywhere · pnpm + Turborepo monorepo · **NestJS** for the B2B API ·
**Postgres-built** double-entry ledger (tested via pglite) · Supabase (DB) + Vercel + Fly/Render ·
bootstrapped/cash-minimal.

---

## Milestone status

| Milestone | Status |
|---|---|
| **E0** Monorepo + escrow core | ✅ Merged (PR #10) |
| **E1** Ledger + lifecycle + compliance | ✅ Merged (PR #11) |
| **E2** Payment-rail abstraction | ✅ Merged (PR #12) — custody (a)+(c) proven on sandbox; (b)+(d) pending Korapay written sign-off |
| **E3** Multi-tenancy + B2B API | 🟡 In progress — **T3.1 ✅** (tenancy: tenants + API keys + RLS); T3.2 (NestJS skeleton) / T3.3 (endpoints) / T3.4 (webhooks) ⬜ |
| E4 KYC + sandbox + docs + SDK | ⬜ |
| E5 Dashboard + hardening + onboarding | ⬜ |

### Packages built (all green; ~104 tests)
- `@clairtus/shared` — Money (integer minor units) + arithmetic + applyBps.
- `@clairtus/core` — fee/split engine (`computeFeeBreakdown`), escrow state machine
  (`applyEscrowEvent`), escrow→ledger posting builders (`escrowLedger.ts`).
- `@clairtus/ledger` — double-entry ledger (accounts/posting groups/entries), `post`
  (atomic, balanced), `getBalance`, `reverse`, idempotency; DB-agnostic via `SqlExecutor`.
- `@clairtus/compliance` — per-market limit engine (BCC: min 1 / daily 500 / monthly 2500 USD),
  live-FX `toUsd/fromUsd`, `checkAmountBounds`, `checkVolumeLimits`, `isStructuring`.
- `@clairtus/payments` — `PaymentRail` interface + `NormalizedEvent` + `RailRouter`
  (config-driven, enable/disable, failover) + **PawaPay adapter** (DRC mobile money)
  + **Korapay adapter** (SA/NG pay-in + payout-from-balance, webhook HMAC verify).
- `@clairtus/tenancy` — tenants + hashed test/live API keys (`Tenancy`: createTenant,
  issueApiKey, authenticate, revokeApiKey) + **Postgres RLS toolkit** (`tenantRlsSql`,
  `withTenant`, `app.current_tenant` GUC) proving invariant #4 (cross-tenant denied).

### Invariants (asserted across tests — keep true)
1. Every ledger posting group balances (Σdebits = Σcredits).
2. An escrow can never release/refund more than is held.
3. Money ops are idempotent (re-posting a reference = no-op).
4. (Future, E3) tenant isolation via Postgres RLS.

---

## NEXT: E3 / T3.2 — NestJS B2B API skeleton (auth guard + idempotency + error envelope)
Branch `claude/e3-tenancy-api` (worktree `.claude/worktrees/e3-tenancy-api`), off main after PR #12.
- **T3.1 ✅ DONE** — `@clairtus/tenancy` (tenants, hashed test/live API keys, RLS isolation; 10 tests).
- **T3.2 (next)** — scaffold `apps/b2b-api` (NestJS): API-key guard wired to `Tenancy.authenticate`;
  `Idempotency-Key` middleware → `idempotency_keys`; consistent error envelope; `/v1` versioning;
  cursor pagination. *Tests first:* idempotent replay returns cached response (invariant #3); auth
  guard (valid/invalid/revoked); error shape. Supertest against the Nest app with a seeded tenant.
- **T3.3** escrow/party/payout endpoints · **T3.4** outbound signed webhooks.
- Production note (from T2.3): payouts need a static egress IP whitelisted in Korapay **Live** mode.

---

## (DONE, merged PR #12) E2 / T2.3 — Korapay adapter (SA) — custody model PROVEN (a)+(c); (b)+(d) need Korapay written confirmation

**Korapay sandbox creds:** in `packages/payments/.env.local` (git-ignored):
`KORAPAY_SECRET_KEY` (sk_test_…), `KORAPAY_PUBLIC_KEY` (pk_test_…), `KORAPAY_ENCRYPTION_KEY`.
Entity: **Fincrest (Pty) Ltd**, Korapay merchant ID **KPY58368**, default currency **NGN**
(sandbox is pre-funded with 5,000,000 in every currency incl. NGN + ZAR).
API base: `https://api.korapay.com`. Docs: developers.korapay.com.

### Adapter — DONE ✅ (`packages/payments/src/adapters/korapay.ts`, 17 contract tests green)
Mirrors the PawaPay pattern (config + fetch injected, fake-fetch contract tests):
- `initiatePayIn` → `POST /merchant/api/v1/charges/bank-transfer` (virtual account) for
  `bank_transfer`, else `POST /merchant/api/v1/charges/initialize` (hosted checkout / redirect — keeps us out of PCI scope).
- `initiatePayout` → `POST /merchant/api/v1/transactions/disburse` (from balance).
- `getStatus` → `GET /merchant/api/v1/charges/:ref`; `getPayoutStatus` → `…/transactions/:ref`.
- `getBalances` → `GET /merchant/api/v1/balances` (→ minor units per currency).
- `parseWebhook` → `{event,data}` → `NormalizedEvent` (charge.success/failed, transfer.success/failed).
- `verifyWebhook` → **HMAC-SHA256 of `JSON.stringify(data)` with the SECRET KEY**, hex,
  header `x-korapay-signature`, timing-safe compare. (Confirmed against Korapay docs.)
- capabilities: countries `['ZA','NG']`, currencies `['ZAR','NGN','USD']`, methods
  `['bank_transfer','card']`, `hold: true`.

### Custody spike — RAN against live sandbox (`packages/payments/scripts/korapay-custody-spike.ts`)
`node --experimental-strip-types packages/payments/scripts/korapay-custody-spike.ts`. Findings vs the 4 T2.3 criteria:
- **(a) collect-into-balance — CONFIRMED ✅** `charges/bank-transfer` returns a temporary
  virtual account, status `processing`; a settled ₦1,000 test charge credited the balance by
  **+946.25 net** (1000 − 50 fee − 3.75 VAT). Funds land in and rest in our Korapay Balance.
- **(b) no forced auto-sweep — partial / needs Korapay sign-off.** Charges sit at `processing`
  in-balance pending our action; auto-settle-to-bank is NOT enabled. Multi-day hold behaviour
  still to be confirmed in writing with Korapay (can't be proven by a single API call).
- **(c) disburse-from-balance on our trigger — CONFIRMED ✅** `transactions/disburse` →
  **HTTP 200** `status: processing`; balance **debited 5,001,892.50 → 5,000,860.25 = −₦1,032.25**
  (₦1,000 payout + ₦32.25 fee). We release from balance whenever we choose. → the escrow
  hold→release model works end-to-end on Korapay.
- **(d) segregation — open / needs Korapay sign-off.** Korapay balance is a POOLED merchant
  balance; per-escrow attribution is our ledger's job (ARCHITECTURE §6.1). Confirm held-funds
  treatment/segregation with Korapay.

> The earlier "Custody ANSWERED ✅ (dashboard string)" was premature — only (a) was evidenced.
> Now (a) AND (c) are evidenced against the live sandbox. (b) + (d) are policy questions for
> Korapay support, not falsifiable via the API; they don't block the adapter but are part of
> the formal "custody confirmed" DoD.

### End-to-end escrow demo — PASSED ✅ (`packages/payments/scripts/korapay-escrow-demo.ts`)
One uninterrupted run, one escrow reference, no dashboard clicks (uses the **Sandbox Credit API**
`POST /merchant/api/v1/virtual-bank-account/sandbox/credit` with `auto_complete:false` to settle the
pay-in instantly; ~2-min auto-complete is the fallback). This satisfies the T2.3 "done when" —
*a full escrow runs end-to-end with funds held in-balance and released on our trigger:*
- FUND: ₦5,000 bank-transfer charge settled → balance **5,001,806.50 → 5,006,752.75 (+4,946.25 net)** = funds HELD.
- RELEASE: disburse on our trigger → balance **5,006,752.75 → 5,001,774.50 (−4,978.25)** = released + payout fee.
- Verdict: ✅ FULL hold→release lifecycle proven on Korapay sandbox.

### ⚠️ Payout IP whitelisting — HARD DEPENDENCY for every environment
Korapay gates the **payout/disburse API by source IP** (collections + balance reads are NOT gated —
that asymmetry is why a valid `sk_test_` key 403'd only on `disburse`). A non-whitelisted IP →
**HTTP 403 `not_authorized`**.
- **Where:** Dashboard → **Settings → Security → IP Whitelisting**; per mode (whitelist in **Test**
  for sandbox, again in **Live** for production). Takes a few minutes to propagate.
- **Sandbox:** dev machine IP `105.233.157.107` whitelisted on 2026-06-03 → spike then succeeded.
  ⚠️ This is a dynamic dev/network IP and will change; not durable.
- **PRODUCTION TODO (plan in E3/E5 deploy):** payouts will run from the B2B API host
  (Fly.io/Render). Provision a **static/dedicated egress IP** for that service and whitelist it in
  Korapay **Live** mode, else all production payouts 403. Treat as a deploy-blocker for go-live.

### Sandbox test data (from Korapay docs)
- Payout SUCCESS: bank `033`, account `0000000000`. FAILURE: bank `035`. INVALID: bank `011`, acct `9999999999`.
- Min/max NGN payout: **₦1,000 – ₦10,000,000** (amounts below ₦1,000 → HTTP 409 conflict).
- Completing a pay-in leg fully (funds landing) needs the inbound transfer simulated in the sandbox dashboard.

### To formally close T2.3 (remaining, non-code)
1. Get Korapay's **written** answer on (b) multi-day hold (no auto-sweep) + (d) held-funds segregation.
2. Plan the production static egress IP + Live-mode whitelist (carry into E3/E5).

---

## Deferred (tracked, non-blocking)
- **B2C deploy of T0.4** (fee-engine repoint) — NOT yet deployed to the live Supabase
  function; the live DRC bot still runs its original code (works fine). One coordinated
  `supabase functions deploy whatsapp-webhook` when convenient.
- **B2C compliance wire** — point the live state machine at `@clairtus/compliance`
  (parity-by-construction); bundle into the same coordinated B2C deploy.

## Branch / PR conventions
- One branch + PR per milestone: `claude/e0-*` (merged), `claude/e1-ledger` (merged),
  `claude/e2-payment-rails` (current). Commit/push as work completes; open a PR at milestone end.
- GitHub repo: `tildakaliba1993/clairtus-v2`.
