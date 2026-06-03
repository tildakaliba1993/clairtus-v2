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
| **E2** Payment-rail abstraction | 🟡 In progress — T2.1 ✅, T2.2 ✅, **T2.3 in progress** |
| E3 Multi-tenancy + B2B API | ⬜ Not started |
| E4 KYC + sandbox + docs + SDK | ⬜ |
| E5 Dashboard + hardening + onboarding | ⬜ |

### Packages built (all green; ~77 tests)
- `@clairtus/shared` — Money (integer minor units) + arithmetic + applyBps.
- `@clairtus/core` — fee/split engine (`computeFeeBreakdown`), escrow state machine
  (`applyEscrowEvent`), escrow→ledger posting builders (`escrowLedger.ts`).
- `@clairtus/ledger` — double-entry ledger (accounts/posting groups/entries), `post`
  (atomic, balanced), `getBalance`, `reverse`, idempotency; DB-agnostic via `SqlExecutor`.
- `@clairtus/compliance` — per-market limit engine (BCC: min 1 / daily 500 / monthly 2500 USD),
  live-FX `toUsd/fromUsd`, `checkAmountBounds`, `checkVolumeLimits`, `isStructuring`.
- `@clairtus/payments` — `PaymentRail` interface + `NormalizedEvent` + `RailRouter`
  (config-driven, enable/disable, failover) + **PawaPay adapter** (DRC mobile money).

### Invariants (asserted across tests — keep true)
1. Every ledger posting group balances (Σdebits = Σcredits).
2. An escrow can never release/refund more than is held.
3. Money ops are idempotent (re-posting a reference = no-op).
4. (Future, E3) tenant isolation via Postgres RLS.

---

## NEXT: E2 / T2.3 — Korapay adapter (SA) + custody spike

**Custody question: ANSWERED ✅** — Korapay settles collected funds into the
**Korapay Balance** (confirmed in dashboard: "NGN Transactions will be settled into
your Korapay Balance"). So fund → hold in balance → disburse on trigger works.

**Korapay sandbox creds:** in `packages/payments/.env.local` (git-ignored):
`KORAPAY_SECRET_KEY` (sk_test_…), `KORAPAY_PUBLIC_KEY` (pk_test_…), `KORAPAY_ENCRYPTION_KEY`.
Entity: **Fincrest (Pty) Ltd**, Korapay merchant ID **KPY58368**, default currency **NGN**.
API base: `https://api.korapay.com`. Docs: developers.korapay.com.

**To build (mirror the PawaPay adapter pattern — config + fetch injected, contract tests with fake fetch):**
- `packages/payments/src/adapters/korapay.ts` implementing `PaymentRail`:
  - `initiatePayIn` → Korapay **charge / collection** API (bank transfer / card / PayShap).
  - `initiatePayout` → Korapay **disbursement** (`/transactions/disburse`), from balance.
  - `getStatus` → Korapay transaction status.
  - `parseWebhook` → Korapay webhook (`data` payload) → `NormalizedEvent`.
  - `verifyWebhook` → **HMAC-SHA256 of the `data` field using the SECRET KEY** (Korapay's scheme).
  - capabilities: countries `['ZA']` (and later NG/KE/GH), currencies (ZAR/NGN/USD per account), methods `['bank_transfer','card']`, `hold: true`.
- Contract tests (fake fetch + fixtures from docs): request shape, response/status mapping, webhook parse + signature verify.
- **Custody spike script** (uses `.env.local`): hit Korapay sandbox to fund-in → confirm balance holds → disburse-from-balance → confirm. Verify with real sandbox calls.

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
