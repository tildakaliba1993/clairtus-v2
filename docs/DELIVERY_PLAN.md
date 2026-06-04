# Clairtus — Delivery Plan to Design-Partner Readiness

**Purpose:** the single sequenced plan that turns the gap analysis ([`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md))
into ordered, buildable milestones. Read with `PRODUCTION_READINESS.md` (the *what's missing*),
`ARCHITECTURE.md` (the *how*), and `PROGRESS.md` (the *build state*).

_Last updated: 2026-06-04 — after Track A M1 (CI/CD) merged-pending._

---

## North star

> **A production-ready B2B Escrow infrastructure that can onboard our first design partners.**
> Onboarding is **manual** for now (operator CLI issues the tenant + keys); a **self-serve portal
> follows later**. So nothing in the critical path depends on self-serve signup.

This splits the work into three phases, each ending at a **gate** we can state plainly:

| Phase | Gate | Meaning |
|---|---|---|
| **Phase 1 — Sandbox** | **Sandbox design-partner ready** | A partner can integrate end-to-end against the sandbox (test keys, simulated rail) from the docs/SDK alone, with enforced limits, scopes, and idempotency. No real money. |
| **Phase 2 — Live money** | **Live-money pilot ready** | A partner can move **real** funds through one escrow: real pay-in collection, inbound rail reconciliation, payouts via the router, KYC live, custody + legal sign-off. |
| **Phase 3 — Scale & self-serve** | **Self-serve & ops ready** | Self-serve signup, key-management UI, admin/dispute console, marketing site, staging, DR, billing. |

**Conventions (unchanged):** TDD first (red→green→refactor); **one branch + PR per milestone**;
every PR gated by CI (M1); `corepack pnpm`, pglite/vitest, no Docker; the API runs under the SWC
runtime (never tsx). Branch names: `claude/m<NN>-<slug>`.

---

## Phase 1 — Sandbox design-partner ready

*Goal: a credible, safe, self-documenting sandbox a partner can build against. All backend/DX; low
risk; no external dependencies. This is the fastest path to "partner #1 integrating".*

### M1 — CI/CD + readiness check ✅ DONE ([PR #18](https://github.com/tildakaliba1993/clairtus-v2/pull/18))
- GitHub Actions: typecheck + full test suite on every PR; deploy-on-merge to Fly (skips until
  `FLY_API_TOKEN` set). New `GET /v1/ready` (DB ping → 503); `/v1/health` stays static liveness.
- *Closes:* §5 CI/CD, §5 readiness-vs-liveness.

### M2 — API security hardening  `claude/m2-api-hardening`
- **Scopes enforced:** `@Scopes('escrows:write', …)` decorator + check in `ApiKeyGuard` → 403 on a
  missing scope. (Keys already carry `scopes[]`; the guard just doesn't check them yet.) Define the
  canonical scope catalogue.
- **Idempotency required** on money-moving POSTs (escrow create/fund/release/refund, payout) → 400
  when the `Idempotency-Key` header is absent; stays optional elsewhere.
- **Rate limiting:** `@nestjs/throttler`, per-API-key, env-tunable default → 429.
- **Input validation:** `class-validator` + a global `ValidationPipe`; convert escrow/party/payout
  DTOs from interfaces → decorated classes → 422 on malformed bodies. *(Also the foundation for M4's
  richer OpenAPI.)*
- *Tests first:* scope allow/deny; missing-idempotency 400; throttle 429; bad payload 422.
- *Closes:* §3 (scopes, required idempotency, rate limiting, input validation).
- *DoD:* every money route is scope-guarded, idempotency-required, throttled, and validated; e2e green.

### M3 — Wire the compliance engine into the escrow lifecycle  `claude/m3-compliance`
- Inject `@clairtus/compliance` into `EscrowService`: `checkAmountBounds` on **create**;
  `checkVolumeLimits` (daily/monthly, summed from the tenant's escrows per market) on **create/fund**;
  `isStructuring` flag; unify the existing single KYC-release gate into **per-market tiers**
  (DRC BCC + SA basics). Pick the FX-rate source for `toUsd` (reuse `fx_rates` / env rate for SA).
- *Tests first:* over-limit create → 422; daily/monthly cap breach → rejected; structuring flagged;
  under-limit passes; per-market release gate.
- *Closes:* §4 "compliance engine not wired" (🔴); partially §4 KYC tiers.
- *DoD:* escrow amounts and releases are limit-checked per market; B2B parity with the B2C engine.

### M4 — SDK published + docs hosted + OpenAPI enriched + real pagination  `claude/m4-sdk-docs`
- **Enrich OpenAPI** from M2's decorated DTOs (real request/response schemas at `/docs`).
- **Publish `@clairtus/sdk`** (npm or versioned tarball) so partners can `npm install` it.
- **Host docs** at `developers.clairtus.com` (the existing `QUICKSTART.md` + generated reference).
- **Cursor pagination** actually applied to `escrows`/`payouts`/`ledger` list endpoints (the utility
  exists but isn't wired) — won't break at scale.
- *Closes:* §6 (thin OpenAPI, SDK not distributed, docs not hosted, list pagination).
- *DoD:* a developer integrates a basic escrow from the hosted docs + installed SDK alone.

### M5 — Error tracking + audit log  `claude/m5-observability`
- **Error tracking (Sentry)** wired into the API (deferred from M1; needs a DSN).
- **Immutable audit log** of money operations + admin actions (architecture §14) — append-only table,
  written on every lifecycle transition + key/scope change.
- *Closes:* §3 audit log, §5 error tracking.
- *DoD:* exceptions surface in Sentry; every money op leaves an immutable audit row.

> **▶ GATE: Sandbox design-partner ready** = M1–M4 done (M5 strongly recommended before partner #1).
> A partner can be **manually onboarded** (operator CLI) and integrate the full sandbox lifecycle.

---

## Phase 2 — Live-money pilot ready

*Goal: one design partner moves real funds through one escrow. Heavier; some items are external
(Korapay, legal). Sequence so code lands behind tests before the external gates are pulled.*

### M6 — Real pay-in collection  `claude/m6-payin`
- Replace simulated funding: `POST /v1/escrows/:id/fund` (live mode) creates a **Korapay collection**
  (bank transfer / hosted checkout), returns payment instructions, and leaves the escrow
  `AWAITING_FUNDING` until funds land — it must **not** post to the ledger on request anymore.
- *Tests first:* live-mode fund returns instructions + rail ref, no premature ledger posting; test
  mode still uses the simulated rail.
- *Closes:* §1 "pay-in is simulated".

### M7 — Inbound rail webhook handler  `claude/m7-rail-webhook`
- `POST /v1/webhooks/korapay` (public, signature-verified) → `parseWebhook` → `NormalizedEvent` →
  drive the lifecycle: `charge.success` marks `FUNDED` (posts the deposit), `transfer.success/failed`
  reconciles payouts. Idempotent on rail ref.
- *Tests first:* HMAC verify; charge.success funds the escrow exactly once (idempotent); transfer
  events reconcile; bad signature → 401.
- *Closes:* §1 "no inbound rail webhook handler"; depends on M6.

### M8 — Payouts via RailRouter + durable queue/DLQ + scheduled worker  `claude/m8-router-queue`
- Route `EscrowService.createPayout` through **`RailRouter.run()`** (circuit breaker + failover now in
  the money path, not a single mode-selected rail).
- Move pay-in/payout/webhook processing onto **`@clairtus/queue`** (enqueue → claim → DLQ on max
  attempts).
- **Schedule the webhook worker** (`processDue`) on a Fly scheduled machine / cron.
- *Tests first:* payout fails over when a rail breaker is open; job retries then dead-letters;
  scheduled worker drains due deliveries.
- *Closes:* §1 payouts-bypass-router, §5 durable queue, §5 webhook worker not scheduled.

### M9 — KYC live + per-market tiers  `claude/m9-kyc-live`
- Set Smile ID **production** creds; per-market KYC tiers (not one global threshold) driving step-up,
  wired to the M3 compliance tiers.
- *Tests first:* tiered gating per market; prod-config smoke (mocked).
- *Closes:* §4 "KYC not live".

### M10 — Korapay live: keys + static egress IP + custody sign-off  `claude/m10-korapay-live` *(external)*
- Provision a **static/dedicated egress IP** for the API host and whitelist it in Korapay **Live**
  mode (payouts 403 without it — proven in E2/T2.3).
- Set `KORAPAY_SECRET_KEY` (live) on Fly.
- Get Korapay's **written** confirmation of custody **(b)** no auto-sweep over a multi-day hold and
  **(d)** held-funds segregation.
- *Closes:* §1 live keys, §1 static egress IP, §1 custody (b)/(d). *Mostly ops/vendor, not code.*

### M11 — Reconciliation + full observability  `claude/m11-recon-otel`
- **Settlement/reconciliation report:** ledger ↔ Korapay balance.
- **OpenTelemetry exporter** on the existing logger/correlation seam; metrics + alerting.
- *Closes:* §1 reconciliation reports, §5 OTel/alerting.

### Legal & regulatory track (parallel, **business-owned**, gates go-live — not code)
- 🔴 **SA escrow/licensing posture** signed off with counsel (Korapay-as-custodian model avoids us
  needing an EME/PSP/escrow licence pre-pilot).
- 🔴 **Design-partner contract + DPA** before live funds.
- 🟡 KYC/AML program aligned to **FICA (SA)**; data retention / POPIA-GDPR windows + DPA.
- *Closes:* §8 (all), §4 AML/FICA, §4 retention. Track as checklist; co-founder-owned.

> **▶ GATE: Live-money pilot ready** = M6–M10 done **and** the legal track signed off. One pilot
> partner can process a real escrow end-to-end.

---

## Phase 3 — Scale, self-serve & polish

*Goal: remove the operator from the loop and round out the product. None of this blocks the first
manual pilots; sequence after Phase 2 (or pull individual items forward if a partner needs them).*

- **Self-serve signup + auth** (Supabase Auth: email/OAuth, sessions, team membership) — replaces the
  pasted-key cookie in the dashboard. *(§2)*
- **API-key management UI** (create / list `last4` / rotate / revoke / scope) + roles/permissions
  (admin vs read-only). Primitives already exist in `@clairtus/tenancy`. *(§2, §3)* — *cheap to pull
  forward into Phase 1 if partner #1 wants self-service keys.*
- **Dashboard write actions** (create/manage escrows, parties, webhooks) + **webhook-endpoint
  management/replay** UI. *(§7, §6)*
- **Admin/ops console** + **dispute workflow** UI (the state machine already has DISPUTED + resolve). *(§7)*
- **B2B marketing site** (`clairtus.com`) + **custom domains** (`app.`/`api.`/`developers.`). *(§7, §9)*
- **Staging environment** (separate deploy, not just sandbox mode); **backups/DR** runbook (RPO/RTO,
  tested restore); Fly HA. *(§5)*
- **Billing / metering** (tenant invoicing/settlement/commission). *(§7)*
- **Automated AML / sanctions / PEP** screening. *(§4)*

---

## Sequencing rationale

1. **M1 first (done)** so every later PR merges behind green CI.
2. **Phase 1 is all backend/DX with no external blockers** → it's the shortest path to a partner
   integrating, and manual onboarding means we skip the heavy self-serve build entirely for now.
3. **Hardening (M2) before compliance (M3)** because validated/scoped inputs are the substrate the
   compliance checks run on; **M2's DTOs feed M4's OpenAPI**.
4. **Phase 2 builds the real-money machinery behind tests (M6–M9) before the external gates (M10,
   legal)** are pulled — so when Korapay live + counsel sign off, the code is already proven.
5. **Phase 3 (self-serve, admin, marketing) is deliberately last** — it's the largest surface and the
   north star explicitly defers it.

## Cut order if time slips
Never cut from ledger / idempotency / RLS / compliance correctness. Cut from Phase 3 first, then
defer Phase 2 reconciliation/OTel polish, then trim Phase 1 to **M1–M4** (M5 audit log can trail
partner #1 by a sprint, but should not trail *live money*).
