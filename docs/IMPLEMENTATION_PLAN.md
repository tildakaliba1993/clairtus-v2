# Clairtus — Implementation Plan (TDD)

**Status:** Draft v1 (for scrutiny & approval)
**Owner:** CTO (Product & Engineering)
**Related docs:** `PRD.md`, `ARCHITECTURE.md`
**Target:** Balanced MVP, ~10–12 weeks, B2B Escrow Infrastructure API ready for SA design partners.

---

## How to use this document

- Work is organized into **Epics (E#)** → **Tasks (T#.#)**. Build in milestone order (M1→M6).
- Every task is **TDD**: write the listed tests first (they fail = 🔴), implement until green (🟢), then refactor.
- Each task carries tags:
  - **[REUSE]** = extract/adapt existing code · **[BUILD]** = new · **[MVP]** = required for design-partner readiness.
- **Definition of Done (per task):** tests written-first and passing, typecheck + lint clean, reviewed, merged behind CI.
- **Definition of Done (MVP):** see the checklist at the end.

**Global TDD invariants** (must always hold, asserted across suites):
1. Every ledger posting group balances (Σdebits = Σcredits).
2. An escrow can never release/refund more than is held.
3. Every money operation is idempotent (replay with same key = no-op).
4. Tenant A can never read/write tenant B's data (RLS).

---

## Milestone overview

| Milestone | Weeks | Goal |
|---|---|---|
| **M1** | 1–2 | Monorepo + core extraction; B2C still live (parity) |
| **M2** | 3–4 | Ledger + compliance engine (tested) |
| **M3** | 5–6 | Payment-rail abstraction + PawaPay & Korapay adapters (+ custody validated) |
| **M4** | 7–9 | Multi-tenancy + B2B API + webhooks + idempotency |
| **M5** | 9–10 | KYC + sandbox + docs + SDK |
| **M6** | 11–12 | Client dashboard + e2e hardening + design-partner onboarding |

---

## E0 — Foundations & Core Extraction (M1)

**T0.1 [BUILD][MVP] Monorepo scaffold**
- Set up pnpm + Turborepo; create `packages/*` and `apps/*`; shared tsconfig, eslint, Vitest config; CI (test+lint+typecheck on PR).
- *Tests first:* a trivial package import test + CI green on a sample unit test.
- *Done when:* `pnpm test` runs across workspaces in CI.

**T0.2 [REUSE][MVP] Bring existing apps into the workspace — RESOLVED BY DECISION (in-place inclusion)**
- **Decision:** do NOT physically relocate the live apps into `apps/`. The Supabase
  functions (`supabase/`), website (`website/`), and admin panel (`admin-panel/`) each
  deploy from their current paths (Supabase CLI conventions; Vercel root directories).
  Moving them would break those deploys for no MVP benefit. They are included in the
  monorepo **in place**; `apps/` is reserved for the new `b2b-api` (E3).
- The meaningful goal — existing code sharing the new packages — is achieved: the **B2C
  WhatsApp app now consumes `@clairtus/core`** (via the vendored `core.deno.js` bundle),
  proven by `deno check` + Deno parity tests.
- *Done:* B2C shares the core; live deploys unchanged; physical relocation deferred to a
  future deploy-coordinated change (update Vercel root dirs + Supabase paths together).

**T0.3 [REUSE][MVP] Extract escrow core (`packages/core`)**
- Extract escrow lifecycle + fee/split engine from `stateMachine.ts` into pure, channel/rail-agnostic functions returning `{escrow, ledgerOps, railOps, events}`.
- *Tests first:* unit tests for each transition; fee/split math (incl. fee-responsibility & secondary split) ported from existing logic as the spec.
- *Done when:* core has no WhatsApp/PawaPay imports; 100% of transitions tested.

**T0.4 [REUSE][MVP] Repoint B2C WhatsApp to core (strangler)**
- WhatsApp webhook becomes a thin client calling `core`; behavior parity in DRC.
- *Tests first:* parity tests comparing old vs new outputs for representative flows.
- *Done when:* DRC flows verified live; no regression.

---

## E1 — Ledger & Compliance (M2)

**T1.1 [BUILD][MVP] Double-entry ledger (`packages/ledger`)**
- `ledger_accounts`, `ledger_entries` (immutable), balanced posting groups; money in integer minor units.
- *Tests first:* posting group balances; balance derivation; reversing entries; concurrency (parallel postings don't corrupt balances) via **pglite** (in-process Postgres, no Docker).
- *Done when:* invariant #1 enforced in code + DB; balances reconcile under concurrent writes.

**T1.2 [BUILD][MVP] Escrow ledger operations**
- Map core `ledgerOps` → postings: hold, release (with split: clairtus_revenue + tenant_payable + recipient_payable), refund, payout.
- *Tests first:* hold→release→payout sequence reconciles to zero in `escrow_held`; partial releases; invariant #2 (no over-release).
- *Done when:* every escrow lifecycle path posts correctly and reconciles.

**T1.3 [REUSE][MVP] Compliance/limit engine (`packages/compliance`)**
- Per-market rule evaluator; port BCC engine (min/per-tx/daily/monthly + live FX) and velocity/structuring detection; SA basics.
- *Tests first:* BCC limit cases (port existing), FX conversion, structuring flag, per-tenant/per-market rule selection.
- *Done when:* B2C uses the engine via core with identical behavior; rules are data-driven.

---

## E2 — Payment Rail Abstraction (M3)

**T2.1 [BUILD][MVP] `PaymentRail` interface + `NormalizedEvent` + Router**
- Define interface, normalized event model, and config-driven router (route by country/currency/method/amount; enable/disable; failover).
- *Tests first:* router selection matrix; enable/disable; failover order; reject unsupported combos.
- *Done when:* router fully unit-tested with fake adapters.

**T2.2 [REUSE][MVP] PawaPay adapter**
- Refactor existing PawaPay client into an adapter implementing `PaymentRail`; normalize its webhooks.
- *Tests first:* contract tests (record/replay) for pay-in/payout/webhook normalization & signature.
- *Done when:* DRC mobile money flows run through the adapter via the router.

**T2.3 [BUILD][MVP] Korapay adapter (SA) + settlement-model validation**
- Implement pay-in (card/EFT/PayShap), payout-**from-balance**, webhook parse/verify against Korapay sandbox.
- **Key insight:** we do NOT need a native "escrow/conditional-release" feature. Escrow = collected funds rest in **our Korapay balance** (Korapay's default settlement target) + our ledger tracks per-escrow attribution + we call payout only when the release condition is met. Custody stays with the licensed PSP.
- **Gating spike first (config, not feature):** confirm with Korapay that (a) collections settle into and **remain in our balance** (do NOT enable auto-settle-to-bank), (b) there is **no forced auto-sweep** during a multi-day hold, (c) we can **disburse from balance** on our trigger any time, and (d) how balance-held funds are treated/segregated. If funds can't rest in-balance, re-plan before building the API on it.
- *Tests first:* contract tests vs Korapay sandbox; pay-in→balance→delayed payout; webhook signature.
- *Done when:* a full escrow runs end-to-end on Korapay sandbox with funds held in-balance and released on our trigger.

---

## E3 — Multi-Tenancy, B2B API & Webhooks (M4)

**T3.1 [BUILD][MVP] Tenant model + RLS isolation + API keys**
- Tenants, hashed test/live API keys, per-tenant config; Postgres RLS on all tenant tables.
- *Tests first:* invariant #4 (cross-tenant access denied); key auth (valid/invalid/revoked); test vs live separation.
- *Done when:* RLS proven by tests attempting cross-tenant reads/writes.

**T3.2 [BUILD][MVP] NestJS API skeleton + auth + idempotency + errors**
- Modules per bounded context; API-key guard; `Idempotency-Key` middleware → `idempotency_keys`; consistent error envelope; `/v1` versioning; cursor pagination.
- *Tests first:* idempotent replay returns cached response (invariant #3); auth guard; error shape.
- *Done when:* skeleton e2e-tested with seeded tenant.

**T3.3 [BUILD][MVP] Escrow + Party + Payout endpoints**
- `escrows` (create/get/fund/release/refund/cancel/dispute), `parties`, `payouts`, `balances`, `ledger`.
- *Tests first:* e2e per endpoint (Supertest) wiring core + ledger + router; partial release/split; refund.
- *Done when:* full escrow lifecycle drivable purely via API.

**T3.4 [BUILD][MVP] Outbound webhooks**
- Signed (HMAC), retried-with-backoff delivery; event catalog; delivery log; replay.
- *Tests first:* signature; retry/backoff; idempotent receiver guidance; delivery logging.
- *Done when:* tenant receives signed events for every lifecycle transition.

---

## E4 — KYC, Sandbox, Docs & SDK (M5)

**T4.1 [REUSE][MVP] KYC provider abstraction + Smile ID adapter + API**
- `KycProvider` interface; wrap Smile ID; `POST /v1/kyc/checks`; status gates higher-ticket release per compliance engine.
- *Tests first:* adapter callback parse/verify; KYC status gating; tiered thresholds.
- *Done when:* a party can be verified via API and gating works.

**T4.2 [BUILD][MVP] Sandbox environment + simulated rail**
- Sandbox mode with a `simulated` rail (deterministic success/failure triggers) + test keys; production parity.
- *Tests first:* sandbox simulated pay-in/payout outcomes; parity assertions.
- *Done when:* a partner can run full flows in sandbox with no real money.

**T4.3 [BUILD][MVP] API docs + quickstart + TypeScript SDK**
- OpenAPI-generated reference; quickstart guide; minimal typed SDK (escrows, parties, payouts, webhooks-verify).
- *Tests first:* SDK methods tested against the API; docs examples run in CI.
- *Done when:* a developer integrates a basic escrow from docs alone.

---

## E5 — Dashboard, Hardening & Onboarding (M6)

**T5.1 [BUILD][MVP] Minimal client dashboard**
- Next.js: API keys, escrows list/detail, balances, payout status, webhook delivery log, sandbox toggle.
- *Tests first:* key auth flows; data isolation in UI; smoke e2e.
- *Done when:* a design partner can self-serve keys + observe activity.

**T5.2 [BUILD][MVP] Observability + reliability hardening**
- Structured logs + correlation IDs + OpenTelemetry; durable queue + DLQ for pay-in/payout/webhooks; per-rail circuit breakers in router.
- *Tests first:* DLQ on repeated failure; breaker opens/closes; trace propagation.
- *Done when:* failures are observable and self-healing within defined limits.

**T5.3 [PROCESS][MVP] Design-partner onboarding kit**
- Manual tenant onboarding runbook; per-partner config; the co-founder's outreach → sandbox → pilot path (ties to LOIs).
- *Done when:* ≥1 SA design partner live in sandbox; ≥1 pilot processing live escrows.

---

## Post-MVP backlog (instrument now, build later)

- **Reputation-graph product** on accumulated `events` + `parties` (data already captured from M1).
- Fincra & card (hosted) rails; multi-currency FX expansion; Nigeria (with CAC entity).
- Automated sanctions/PEP screening; reconciliation/settlement reports; self-serve tenant signup.
- SOC2/PCI trajectory; own EME/PSP licensing (deep moat).

---

## MVP "Design-Partner Ready" checklist

- [ ] B2C DRC app live on the shared `core` (parity proven).
- [ ] Double-entry ledger correct under concurrency; all invariants enforced.
- [ ] Korapay (SA) + PawaPay (DRC) adapters live behind the router; **custody/hold confirmed**.
- [ ] Full escrow lifecycle via API (create → fund → hold → release/split → payout → refund/dispute).
- [ ] Idempotency + signed webhooks + event catalog.
- [ ] KYC via Smile ID, gating higher-ticket.
- [ ] Sandbox + docs + SDK published; integratable without hand-holding.
- [ ] Minimal client dashboard.
- [ ] Per-market compliance engine (DRC BCC + SA basics).
- [ ] ≥1 design partner in sandbox; ≥1 pilot live.

---

## Sequencing notes & risk controls

- **Custody validation (T2.3) is a gating spike** — do the Korapay hold-funds confirmation early in M3; if it fails, re-plan escrow settlement before building the API on it.
- **Keep the DRC app live throughout** (strangler) — M1 must not regress it.
- **Solo-build discipline:** if a milestone slips, cut from E5/post-MVP, never from ledger/idempotency/RLS correctness.
- **Parallelizable while you build:** co-founder runs SA design-partner outreach + Nigeria CAC registration from M1, so a pilot is ready by M6.
