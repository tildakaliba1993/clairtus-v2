# Clairtus — Full Product Requirements (Phases 1–3)

**Status:** Living document · **Owner:** CTO (Product & Engineering) · **Last updated:** 2026-06-04
**End goal:** a production-ready **B2B Escrow Infrastructure** that onboards design partners — manually
first, self-serve later — and becomes the horizontal trust layer for African commerce.

> **New to the team? Read in this order:**
> 1. [`PRD.md`](PRD.md) — the *why*: vision, market, moats, customers (don't skip; this doc assumes it).
> 2. **This doc** (`PRD_FULL.md`) — the *what*, across all three phases and every milestone.
> 3. [`DELIVERY_PLAN.md`](DELIVERY_PLAN.md) — the *sequence*: phases, gates, milestone ordering.
> 4. [`IMPLEMENTATION_TASKS.md`](IMPLEMENTATION_TASKS.md) — the *how*: task-by-task engineering plan.
> 5. [`ARCHITECTURE.md`](ARCHITECTURE.md) — the system design the work plugs into.
> 6. [`PROGRESS.md`](PROGRESS.md) — current build state · [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md) — the gap analysis this plan closes.
>
> Then run the stack: [`QUICKSTART.md`](QUICKSTART.md) (integrate) · [`DEPLOYMENT.md`](DEPLOYMENT.md) (deploy) · [`ONBOARDING.md`](ONBOARDING.md) (onboard a partner).

---

## 1. The product in one page

Clairtus is a **multi-tenant, rail-agnostic REST API** that lets any marketplace embed **escrow**: hold a
buyer's money with a licensed PSP, release it to the seller on the platform's trigger (delivery, job
done, milestone), split platform commission, pay out, and handle refunds/disputes — all backed by a
double-entry ledger, signed webhooks, KYC, and a per-market compliance engine.

**We never take custody.** Funds rest in the licensed PSP's balance (Korapay in SA, PawaPay in DRC); our
ledger attributes them per-escrow; we trigger payout only when the release condition is met. This keeps
us out of needing our own EME/PSP licence to launch (see [`PRD.md` §10](PRD.md) and `ARCHITECTURE.md §6.1`).

**The data by-product is the moat:** every escrow outcome is a signed, retained event keyed to party
identity → a future cross-platform **reputation graph**. We instrument for it from day one.

### Where we are today (the starting line)
The MVP (E0–E5) is **built, merged, and deployed live**:
- **API** live on Fly.io (`clairtus-api.fly.dev`, `/v1`, `/docs`), Supabase Postgres, auto-migrating.
- **Dashboard** live on Vercel (read-only; connect with a `ck_test_` key).
- **Domain core** (all tested, ~190 tests): double-entry ledger, fee/split engine, escrow state machine,
  per-market compliance engine, payment-rail abstraction (PawaPay + Korapay + simulated), KYC (Smile ID),
  tenancy + RLS, signed outbound webhooks, durable queue + circuit breaker, typed SDK.
- **Sandbox** runs end-to-end (test key → create → fund → release → payout via the simulated rail).

**What's NOT done** (and is the entire subject of this document): the live MVP has gaps that stop it
being *production-ready* and *safe for real money*. Pay-in is simulated; there's no inbound rail webhook
handler; the compliance engine isn't wired into the API; scopes/idempotency/rate-limits aren't enforced;
payouts bypass the router; the queue isn't wired; KYC/Korapay aren't live; there's no self-serve, audit
log, CI/CD (now landed), or hosted docs. [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md) enumerates
every gap with severity; this PRD turns them into requirements organized by phase and milestone.

---

## 2. Personas & primary journeys

| Persona | Who | What they need from us |
|---|---|---|
| **Partner Developer** | Integrates Clairtus into a marketplace | Clear API + SDK + sandbox + docs; predictable errors; webhooks to drive their UI; scoped keys |
| **Partner Operator** | Runs the marketplace day-to-day | Dashboard: balances, escrows, payouts, webhook log; (later) manage keys, escrows, disputes |
| **Buyer** | Pays into escrow on a partner platform | Easy pay-in (bank transfer / PayShap / card), proof funds are secured, refund if it goes wrong |
| **Seller / Beneficiary** | Receives payout | Fast, reliable payout; KYC when higher-ticket |
| **Clairtus Operator** | Us | Onboard tenants, resolve disputes, reconcile ledger↔PSP, monitor health, respond to incidents |

**Core journey (the thing that must work flawlessly):**
`Partner creates escrow → buyer funds it → funds held with PSP → partner triggers release → split computed
→ seller paid out → webhooks fired at every step → ledger reconciles to zero`. Plus refund/cancel/dispute
branches. Phase 1 makes this safe & documented **in sandbox**; Phase 2 makes it real **with real money**.

---

## 3. Phased roadmap & gates

| Phase | Gate (plain English) | Milestones |
|---|---|---|
| **1 — Sandbox** | *A partner can integrate the full sandbox lifecycle from docs/SDK alone, with enforced limits, scopes, idempotency. No real money.* | M1✅ · M2 · M3 · M4 · M5 |
| **2 — Live money** | *One partner moves real funds through one escrow end-to-end; KYC live; custody + legal signed off.* | M6 · M7 · M8 · M9 · M10 · M11 · Legal track |
| **3 — Scale & self-serve** | *Partners onboard themselves; full ops/admin/marketing surfaces; staging, DR, billing.* | Self-serve, admin, marketing, ops |

Conventions for all phases: **TDD first**, **one branch + PR per milestone**, **CI-gated**, money-logic
invariants always hold (ledger balances; never release/refund more than held; idempotent replays; tenant
isolation via RLS).

---

## 4. Phase 1 — Sandbox design-partner ready

*Outcome: the API is safe, correct, limit-enforcing, and self-documenting, so a design partner can be
**manually onboarded** and integrate the full sandbox lifecycle without hand-holding.*

### M1 — CI/CD + readiness check ✅ DONE
**Objective:** every change is gated by automated checks; the service reports real readiness.
**Requirements**
- PR-1.1 CI runs typecheck + full test suite (packages + apps) on every PR into `main`.
- PR-1.2 Deploy-on-merge to Fly (`--ha=false`), skipping gracefully until `FLY_API_TOKEN` is set.
- PR-1.3 `GET /v1/ready` verifies DB connectivity → `503` when down; `/v1/health` stays static liveness.
**Acceptance:** green CI required to merge; `/v1/ready` returns 503 when DB unreachable.
**Shipped in** [PR #18](https://github.com/tildakaliba1993/clairtus-v2/pull/18). *(Sentry deferred to M5.)*

### M2 — API security hardening
**Objective:** every money endpoint is authenticated, **authorized (scoped)**, idempotent-by-requirement,
rate-limited, and input-validated.
**Requirements**
- PR-2.1 **Scopes enforced.** API keys carry scopes (`escrows:read`, `escrows:write`, `payouts:write`,
  `parties:write`, `kyc:write`, …). A `@Scopes()` decorator + `ApiKeyGuard` check returns **403** when the
  key lacks the route's scope. Define and document the canonical scope catalogue.
- PR-2.2 **Idempotency required** on money-moving POSTs (escrow create, fund, release, refund; payout).
  Missing `Idempotency-Key` → **400**. (Non-money POSTs stay optional.)
- PR-2.3 **Rate limiting** per API key (`@nestjs/throttler`), env-tunable, → **429** on breach.
- PR-2.4 **Input validation.** Global `ValidationPipe` + `class-validator`; DTOs become decorated classes;
  malformed/over/under-spec payloads → **422** with a consistent error envelope.
**User stories:** *As a partner, a read-only key cannot move money (403). As the platform, a retried fund
with the same key never double-charges (existing) and a fund without a key is rejected (400).*
**Acceptance:** e2e tests prove 403/400/429/422 on the relevant routes; existing lifecycle tests still green.
**Closes:** PRODUCTION_READINESS §3.

### M3 — Compliance engine wired into the lifecycle
**Objective:** escrow amounts and releases obey per-market limits and KYC tiers — no money operation runs
without a compliance decision.
**Requirements**
- PR-3.1 **Amount bounds** (`checkAmountBounds`) enforced on escrow **create** (min/per-tx per market).
- PR-3.2 **Volume limits** (`checkVolumeLimits`, daily/monthly) enforced on **create/fund**, summed from the
  tenant's prior escrows per market, using a defined FX source for `toUsd`.
- PR-3.3 **Structuring detection** (`isStructuring`) flags suspicious repeat patterns → step-up/àreview.
- PR-3.4 **Per-market KYC tiers** replace the single global release threshold; higher-ticket release
  requires a VERIFIED seller per the market's tier.
- PR-3.5 Every compliance decision is recorded (feeds the M5 audit log).
**Markets at launch:** DRC (BCC: 1 USD min, 500 USD/day & per-tx, 2,500 USD/month, live USD↔CDF) and
South Africa (FICA-aligned basics).
**Acceptance:** over-limit create → 422; daily/monthly breach → rejected; structuring flagged; under-limit
passes; release gated per market; B2B decisions match the B2C engine (parity).
**Closes:** §4 (compliance not wired; KYC tiers).

### M4 — SDK published + docs hosted + OpenAPI enriched + real pagination
**Objective:** a developer integrates from the docs + installed SDK alone.
**Requirements**
- PR-4.1 **OpenAPI enriched** from M2's decorated DTOs → real request/response schemas at `/docs`.
- PR-4.2 **SDK published** (`@clairtus/sdk` to npm or a versioned tarball) with semver + changelog.
- PR-4.3 **Docs hosted** at `developers.clairtus.com` (QUICKSTART + generated reference + webhook guide).
- PR-4.4 **Cursor pagination** actually applied to `escrows`/`payouts`/`ledger` lists (utility exists).
**Acceptance:** the QUICKSTART flow runs against the SDK installed from the registry; `/docs` shows
populated schemas; list endpoints page with a cursor.
**Closes:** §6. **Depends on:** M2 (DTOs).

### M5 — Error tracking + immutable audit log
**Objective:** we can see failures and prove what happened to money.
**Requirements**
- PR-5.1 **Error tracking (Sentry)** in the API (deferred from M1; needs a DSN), with correlation-id context.
- PR-5.2 **Immutable audit log** (append-only) of every money operation + key/scope/admin change, written
  on each lifecycle transition (architecture §14). Queryable by tenant + escrow.
**Acceptance:** an exception appears in Sentry with request id; every money op leaves an audit row that
cannot be mutated.
**Closes:** §3 audit log, §5 error tracking.

> **▶ GATE 1 — Sandbox design-partner ready** = M1–M4 complete (M5 strongly recommended before partner #1).
> **Success metric:** ≥1 SA design partner manually onboarded and integrating in sandbox without hand-holding.

---

## 5. Phase 2 — Live-money pilot ready

*Outcome: a design partner moves **real** funds through a real escrow end-to-end. Heavier; some items are
external (Korapay, counsel). Code lands behind tests before the external gates are pulled.*

### M6 — Real pay-in collection
**Objective:** funding collects real money instead of simulating it.
**Requirements**
- PR-6.1 Live-mode `POST /v1/escrows/:id/fund` creates a **Korapay collection** (bank transfer / hosted
  checkout) and returns **payment instructions** (virtual account / redirect link).
- PR-6.2 The escrow stays `AWAITING_FUNDING` and **does not post to the ledger** until funds actually land.
- PR-6.3 Test mode is unchanged (simulated rail) — sandbox parity preserved.
**Acceptance:** live fund returns instructions + rail ref with no premature ledger posting; test fund still
posts synchronously via the simulated rail.
**Closes:** §1 simulated pay-in.

### M7 — Inbound rail webhook handler
**Objective:** real pay-ins and payout results reconcile automatically.
**Requirements**
- PR-7.1 Public, **HMAC-verified** `POST /v1/webhooks/korapay` → `parseWebhook` → `NormalizedEvent`.
- PR-7.2 `charge.success` marks the escrow `FUNDED` and posts the deposit — **exactly once** (idempotent on
  rail ref). `charge.failed` leaves it awaiting/failed.
- PR-7.3 `transfer.success/failed` reconciles the payout state and fires the outbound webhook.
- PR-7.4 Bad signature → 401; unknown event → 2xx-ignored (no retry storm).
**Acceptance:** signed charge.success funds once under duplicate delivery; transfer events reconcile;
forged signature rejected.
**Closes:** §1 no inbound handler. **Depends on:** M6.

### M8 — Payouts via RailRouter + durable queue/DLQ + scheduled worker
**Objective:** the money path is resilient (failover + retries) and durable (no lost work).
**Requirements**
- PR-8.1 `EscrowService.createPayout` routes through **`RailRouter.run()`** so circuit breakers + failover
  are in the live money path (not a single mode-selected rail).
- PR-8.2 Pay-in/payout/webhook processing runs on **`@clairtus/queue`** (enqueue → claim → retry with
  backoff → **DLQ** after max attempts).
- PR-8.3 The webhook retry worker (`processDue`) runs on a **Fly scheduled machine / cron**.
**Acceptance:** payout fails over when a breaker is open; a permanently failing job dead-letters; the
scheduled worker drains due deliveries in prod.
**Closes:** §1 router bypass, §5 queue not wired, §5 worker not scheduled.

### M9 — KYC live + per-market tiers
**Objective:** identity verification is real and tiered.
**Requirements**
- PR-9.1 Smile ID **production** credentials configured (prod base URL).
- PR-9.2 Per-market KYC **tiers** drive step-up and release eligibility, wired to M3's compliance tiers.
**Acceptance:** tiered gating per market; a real verification round-trips in a controlled test.
**Closes:** §4 KYC not live.

### M10 — Korapay live: keys + static egress IP + custody sign-off *(largely external/ops)*
**Objective:** the live rail actually works and custody/segregation is confirmed.
**Requirements**
- PR-10.1 Provision a **static/dedicated egress IP** for the API host; whitelist it in Korapay **Live** mode
  (payouts 403 without it — proven in E2/T2.3).
- PR-10.2 Set live `KORAPAY_SECRET_KEY` (+ webhook URL) as Fly secrets.
- PR-10.3 Obtain Korapay's **written** confirmation of custody **(b)** no auto-sweep over a multi-day hold
  and **(d)** held-funds segregation.
**Acceptance:** a live sandbox→prod payout succeeds from the whitelisted IP; custody answers on file.
**Closes:** §1 live keys, static egress IP, custody (b)/(d).

### M11 — Reconciliation + full observability
**Objective:** we can prove the books match the PSP and see the system in production.
**Requirements**
- PR-11.1 **Settlement/reconciliation report:** ledger balances vs Korapay balance, per currency, with drift
  alerts.
- PR-11.2 **OpenTelemetry exporter** on the existing logger/correlation seam; metrics + **alerting** on
  error rate, queue depth, DLQ, breaker-open, recon drift.
**Acceptance:** a recon report runs and reconciles; traces/metrics flow to the collector; an alert fires on
an injected fault.
**Closes:** §1 reconciliation, §5 OTel/alerting.

### Legal & regulatory track *(parallel · business-owned · gates go-live)*
- LR-1 🔴 **SA escrow/licensing posture** signed off with counsel (Korapay-as-custodian avoids us needing an
  EME/PSP/escrow-agent licence pre-pilot). *Fundamental go-live gate.*
- LR-2 🔴 **Design-partner contract + DPA** executed before real funds move.
- LR-3 🟡 **KYC/AML program** documented & FICA-aligned (SA); sanctions/PEP screening plan.
- LR-4 🟡 **Data retention / POPIA-GDPR** windows, deletion, DPA terms.
**Closes:** §8 (all), §4 AML/retention.

> **▶ GATE 2 — Live-money pilot ready** = M6–M10 done **and** the legal track signed off (M11 strongly
> recommended at/with first live volume). **Success metric:** ≥1 pilot partner processing real escrows.

---

## 6. Phase 3 — Scale, self-serve & polish

*Outcome: remove the operator from the loop and round out the product. None of this blocks the manual
pilots; sequence after Phase 2, but any item can be pulled forward if a partner needs it.*

| Area | Requirements | Closes |
|---|---|---|
| **Self-serve auth** | Tenant signup + login (Supabase Auth: email/OAuth), sessions, team membership; replaces the pasted-key cookie in the dashboard. | §2 |
| **API-key management UI** | Create / list (`last4`) / rotate / revoke / **scope** keys from the dashboard; roles (admin vs read-only). Primitives exist in `@clairtus/tenancy`. *Cheap to pull into Phase 1 if partner #1 wants self-service keys.* | §2, §3 |
| **Dashboard write actions** | Create/manage escrows, parties, webhook endpoints; webhook **replay** from the UI. | §6, §7 |
| **Admin / ops console** | Tenant management, transaction monitoring, **dispute resolution workflow** (state machine already has DISPUTED + resolve). | §7 |
| **B2B marketing + domains** | `clairtus.com` B2B landing; custom domains `app.` / `api.` / `developers.`. | §7, §9 |
| **Resilience & ops** | Separate **staging** environment; **backups/DR** runbook (RPO/RTO, tested restore); Fly **HA**. | §5 |
| **Billing / metering** | Tenant invoicing/settlement/commission payout off the fee engine. | §7 |
| **Compliance automation** | Automated **sanctions / PEP** screening; advanced reconciliation/reporting. | §4 |

> **▶ GATE 3 — Self-serve & ops ready** = self-serve signup + key management + admin console live; staging
> + DR in place. **Success metric:** a partner onboards and issues keys with zero operator involvement.

---

## 7. Cross-cutting requirements (apply to every phase)

- **Security:** API-key bearer auth, hashed secrets, **per-tenant RLS** + service-layer scoping, scopes
  enforced (M2), TLS, minimal PCI scope (hosted/redirect collection only), signed inbound + outbound
  webhooks, immutable audit log (M5).
- **Reliability:** idempotency on every money op; durable queue + DLQ (M8); per-rail circuit breakers in the
  router; signed, retried webhooks. Invariants asserted in tests.
- **Observability:** structured logs + correlation ids (built); Sentry (M5); OTel + metrics + alerting (M11).
- **Compliance:** per-market rule engine (M3); KYC tiers (M3/M9); custody-via-licensed-PSP; retention per
  market (≥5–10 yrs); no structuring.
- **NFR targets:** MVP availability 99.5% → 99.9%; ledger correct under concurrency; stateless API horizontal
  scale; cursor pagination (M4) for list growth.

(Full NFR/compliance rationale: [`PRD.md` §9–§10](PRD.md) and `ARCHITECTURE.md §14–§16`.)

---

## 8. Success metrics by gate

| Gate | Primary metric | Supporting |
|---|---|---|
| **Gate 1 (Sandbox)** | ≥1 design partner integrating in sandbox unaided | Docs/SDK published; 0 manual hand-holding steps; all money routes scoped/idempotent/limited |
| **Gate 2 (Live money)** | ≥1 pilot processing **real** escrows | E2E real escrow on Korapay (SA); ledger↔PSP reconciles; KYC live; legal signed |
| **Gate 3 (Self-serve)** | A partner onboards with **zero** operator involvement | Self-serve signup + keys; admin/dispute console in use; staging + DR exercised |
| **Investability (pre-seed)** | Live B2C proof + signed LOIs + working API demo | Reputation-graph event data accruing per party |

---

## 9. Glossary (for new joiners)

- **Escrow** — funds held with a licensed PSP, attributed per-transaction in our ledger, released on the
  platform's trigger. We orchestrate; we don't custody.
- **Rail / adapter** — a payment provider behind one `PaymentRail` interface (Korapay SA, PawaPay DRC,
  Simulated for sandbox). The **RailRouter** picks one by country/currency/method + handles failover.
- **Pay-in / Payout** — money collected from the buyer / disbursed to the seller, each via a rail.
- **Hold** — the period funds rest in the PSP balance before release; "escrow = hold + ledger attribution".
- **Ledger** — double-entry, integer minor units, immutable entries, balanced posting groups; source of
  truth for money.
- **Tenant** — a client platform (our customer). **Party** — a buyer/seller/beneficiary within a tenant.
- **Scope** — a permission on an API key (e.g. `escrows:write`). **Mode** — `test` vs `live` key.
- **Idempotency-Key** — header that makes a money POST safe to retry.
- **Compliance engine** — per-market limit/KYC/structuring evaluator (`@clairtus/compliance`).
- **DLQ** — dead-letter queue for jobs that exhausted retries.
- **Gate** — a stated, checkable readiness bar at the end of a phase.

---

## 10. Open decisions / assumptions log

- **Manual onboarding accepted for early partners** → self-serve signup is Phase 3 (not critical path).
- **FX source for `toUsd`** (M3) — reuse `fx_rates` (DRC) + an env/admin rate for SA; finalize in M3.
- **Custody (b)/(d)** — falsifiable only by Korapay written confirmation (M10/LR), not by API.
- **Static egress IP** — Fly dedicated egress vs static-IP proxy/NAT — decide in M10.
- **SA licensing posture** — assumed Korapay-as-custodian avoids own licence pre-pilot; **counsel must
  confirm (LR-1)** before live funds. This is the single biggest external risk.
- This is a living document — refined as milestones complete and decisions land.
