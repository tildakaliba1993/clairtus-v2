# Clairtus — Implementation Tasks (Phases 1–3)

**Purpose:** the engineering task breakdown for every phase and milestone in
[`PRD_FULL.md`](PRD_FULL.md) / [`DELIVERY_PLAN.md`](DELIVERY_PLAN.md). Each task is small, test-first, and
maps to a product requirement (PR-x). A new engineer should be able to pick up any task and know exactly
what to build, where, and how to prove it's done.

> This document covers the **forward work** (Phases 1–3). The **already-built MVP** (epics E0–E5) is
> documented task-by-task in [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — read that for the code
> these tasks extend.

---

## How to work here (read once)

- **TDD:** write the listed test(s) first (red), implement to green, then refactor. Money logic has no
  untested paths.
- **One branch + PR per milestone:** `claude/m<NN>-<slug>`. PR is gated by CI (M1). Merge before the next.
- **Commands:** `corepack pnpm install` · typecheck `corepack pnpm -r --filter "./packages/*" --filter
  "./apps/*" typecheck` · test `… test`. No Docker (pglite + jsdom). API runs under the **SWC runtime** —
  never switch to tsx (DI breaks).
- **Invariants (assert in tests, never break):** ① posting groups balance ② never release/refund more
  than held ③ money ops idempotent ④ tenant isolation via RLS.
- **Estimate key:** S ≈ ≤1 day · M ≈ 2–3 days · L ≈ ~1 week (solo, AI-assisted).
- **Status legend:** ✅ done · ⬜ todo · 🔵 in progress · 🧩 external/non-code.

### Status snapshot
| Milestone | Status | PR |
|---|---|---|
| M1 CI/CD + readiness | ✅ | [#18](https://github.com/tildakaliba1993/clairtus-v2/pull/18) |
| M2–M11, Legal, Phase 3 | ⬜ | — |

---

# PHASE 1 — Sandbox design-partner ready

## M1 — CI/CD + readiness ✅ DONE
| Task | What | Tests-first | Files | DoD |
|---|---|---|---|---|
| T1.1 ✅ | CI workflow: typecheck+test on PR | n/a (workflow) | `.github/workflows/ci.yml` | CI green required to merge |
| T1.2 ✅ | Deploy workflow: verify→`fly deploy --ha=false`, skip w/o token | n/a | `.github/workflows/deploy.yml` | Deploys on merge once `FLY_API_TOKEN` set |
| T1.3 ✅ | `GET /v1/ready` DB ping → 503; `/v1/health` static | `app.controller.spec.ts` (3) | `apps/b2b-api/src/app.controller.ts` | Ready 503 when DB down |

## M2 — API security hardening · `claude/m2-api-hardening`
*Maps to PR-2.x. The guard/interceptor seams already exist — this fills them in.*

| Task | What | Tests-first | Files / areas | Est |
|---|---|---|---|---|
| T2.1 | **Scope catalogue + `@Scopes()` decorator** | decorator metadata read in a unit test | new `common/scopes.decorator.ts`; doc the scope list | S |
| T2.2 | **Enforce scopes in `ApiKeyGuard`** → 403 when `auth.scopes` lacks the route's required scope | guard spec: key with/without scope; `@Public` still bypasses | `common/api-key.guard.ts` (uses `Reflector`, `AuthContext.scopes` already present) | S |
| T2.3 | Annotate every route with its scope | e2e: read-only key blocked from write routes (403) | `escrow.controller.ts`, `party.controller.ts`, `payout.controller.ts`, `kyc.controller.ts` | S |
| T2.4 | **Require `Idempotency-Key`** on money POSTs → 400 if absent | e2e: fund without key → 400; with key still works/replays | extend `common/idempotency.interceptor.ts` (or a small guard) + mark money routes | M |
| T2.5 | **Rate limiting** per API key | e2e: N+1 requests → 429 | add `@nestjs/throttler`; key-based `ThrottlerGuard`; `app.module.ts` | M |
| T2.6 | **Validation:** global `ValidationPipe` + decorated DTO classes | e2e: malformed/over-range body → 422 | add `class-validator`/`class-transformer`; convert `CreateEscrowDto`/`CreatePartyDto`/`CreatePayoutDto` (in `escrow.service.ts`) to classes; `main.ts` pipe | M |
| T2.7 | Onboarding CLI issues keys with sensible default scopes | unit: issued key carries scopes | `apps/b2b-api/src/onboarding/onboard.ts`, `@clairtus/tenancy issueApiKey` | S |

**Milestone DoD:** money routes are scope-guarded (403), idempotency-required (400), throttled (429),
validated (422); all prior e2e green; OpenAPI now has DTO schemas (feeds M4).

## M3 — Compliance wired into the lifecycle · `claude/m3-compliance`
*`@clairtus/compliance` exports `checkAmountBounds`, `checkVolumeLimits`, `isStructuring`, `toUsd/fromUsd`,
`BCC_RULES`, `bccRulesFromEnv` — none imported by the API yet.*

| Task | What | Tests-first | Files / areas | Est |
|---|---|---|---|---|
| T3.1 | **Per-market rule resolution** (tenant.country → rule set; SA basics + DRC BCC) | unit: correct rules per market | new `escrow/compliance.ts` (adapter) using `@clairtus/compliance` | S |
| T3.2 | **FX source** for `toUsd` (reuse `fx_rates`/env SA rate) | unit: conversion at a known rate | `escrow/compliance.ts` | S |
| T3.3 | **Amount bounds on create** → 422 below min / above per-tx | e2e: over/under bounds rejected; valid passes | `escrow.service.ts#createEscrow` | M |
| T3.4 | **Volume limits on create/fund** (daily/monthly from prior escrows) | e2e: daily & monthly cap breach rejected | `escrow.service.ts` + a per-tenant/market volume query | M |
| T3.5 | **Structuring flag** | unit/e2e: repeated near-limit txns flagged | `escrow/compliance.ts`, `escrow.service.ts` | S |
| T3.6 | **Per-market KYC tiers** replace single `KYC_RELEASE_THRESHOLD` gate | e2e: tiered release gate per market | `escrow.service.ts#release` (currently global threshold) | M |
| T3.7 | Emit a **compliance decision record** (feeds M5 audit) | unit: decision persisted | new `compliance_decisions` table or events | S |

**Milestone DoD:** no escrow create/fund/release runs without a per-market compliance decision; parity
with the B2C engine; tests cover every limit path.

## M4 — SDK + docs + OpenAPI + pagination · `claude/m4-sdk-docs` *(depends on M2)*

| Task | What | Tests-first | Files / areas | Est |
|---|---|---|---|---|
| T4.1 | **Enrich OpenAPI** with `@ApiProperty` on the M2 DTO classes + response types | spec test asserts populated schemas | DTO classes; `apps/b2b-api/src/openapi.ts` | M |
| T4.2 | **Cursor pagination** on `escrows`/`payouts`/`ledger` (apply existing `common/pagination.ts`) | e2e: paged list returns cursor; next page continues | `escrow.service.ts` list methods + controllers | M |
| T4.3 | **Publish `@clairtus/sdk`** (build, semver, changelog, npm/tarball) | existing SDK tests; add a packaged-install smoke | `packages/sdk` build + publish config | M |
| T4.4 | **Host docs** at `developers.clairtus.com` (QUICKSTART + generated reference + webhook verify guide) | docs examples run in CI | docs site (Vercel) or Swagger static export | M |

**Milestone DoD:** a dev integrates the QUICKSTART flow using the **published** SDK; `/docs` schemas
populated; lists paginate by cursor.

## M5 — Error tracking + audit log · `claude/m5-observability`

| Task | What | Tests-first | Files / areas | Est |
|---|---|---|---|---|
| T5.1 | **Sentry** init + error filter integration, correlation-id context | unit: filter reports + preserves envelope | `common/http-error.filter.ts`, `main.ts`; `@sentry/node` (needs DSN) | M |
| T5.2 | **Immutable audit log** table (append-only) + writer | unit: row written per money op; no update/delete | new `audit/audit.service.ts` + `audit_log` schema; call from `escrow.service.ts` transitions | M |
| T5.3 | Audit key/scope/admin changes | unit: key issue/revoke audited | `@clairtus/tenancy` callers / onboarding | S |

**Milestone DoD:** exceptions reach Sentry with request id; every money op + key change leaves an immutable
audit row queryable by tenant+escrow. **→ GATE 1 reached (with M1–M4).**

---

# PHASE 2 — Live-money pilot ready

## M6 — Real pay-in collection · `claude/m6-payin`
| Task | What | Tests-first | Files / areas | Est |
|---|---|---|---|---|
| T6.1 | **Live-mode fund** calls Korapay `initiatePayIn`, returns instructions (virtual acct / link) | e2e (fake rail): live fund returns instructions + rail ref | `escrow.service.ts#fund` (branch by key mode), `KorapayRail` | M |
| T6.2 | **No ledger posting on request** in live mode; escrow stays `AWAITING_FUNDING` | e2e: ledger untouched until webhook | `escrow.service.ts#fund` | M |
| T6.3 | Persist the pay-in intent (`payins` row, rail ref, status) | unit: intent stored | `payins` table, service | S |
| T6.4 | Test mode unchanged (simulated rail, synchronous) | existing sandbox e2e still green | — | S |

**DoD:** live fund returns real instructions with no premature posting; sandbox parity preserved.

## M7 — Inbound rail webhook handler · `claude/m7-rail-webhook` *(depends on M6)*
| Task | What | Tests-first | Files / areas | Est |
|---|---|---|---|---|
| T7.1 | **Public, HMAC-verified** `POST /v1/webhooks/korapay` | e2e: valid sig 2xx; forged → 401 | new `webhooks/korapay.controller.ts` (`@Public`), `KorapayRail.verifyWebhook` | M |
| T7.2 | `parseWebhook → NormalizedEvent` dispatch | unit: each event maps correctly | reuse `KorapayRail.parseWebhook` | S |
| T7.3 | **`charge.success` funds the escrow exactly once** (idempotent on rail ref) | e2e: duplicate delivery funds once; ledger balances | `escrow.service.ts`, idempotent on `payins.rail_ref` | L |
| T7.4 | `transfer.success/failed` reconciles payout + fires outbound webhook | e2e: payout state transitions | `escrow.service.ts`, `webhook.service.ts` | M |
| T7.5 | Unknown/duplicate events handled (no retry storm) | e2e: unknown event → 200 ignored | controller | S |

**DoD:** real pay-ins/payouts reconcile automatically and idempotently from signed webhooks.

## M8 — Router + queue/DLQ + scheduled worker · `claude/m8-router-queue`
| Task | What | Tests-first | Files / areas | Est |
|---|---|---|---|---|
| T8.1 | Route `createPayout` through **`RailRouter.run()`** (breaker + failover) | e2e: open breaker → failover; skip open rail | `escrow.service.ts#createPayout`, `@clairtus/payments` router | M |
| T8.2 | Enqueue pay-in/payout/webhook work on **`@clairtus/queue`** | unit: enqueue→claim→complete | `@clairtus/queue JobQueue`, service wiring | L |
| T8.3 | **DLQ** after max attempts (backoff) | unit: failing job dead-letters | `@clairtus/queue` (already supports) + handlers | M |
| T8.4 | **Schedule `processDue`** on a Fly scheduled machine/cron | manual: due deliveries drain in prod | `webhook-worker` script + `fly.toml`/scheduled machine; `DEPLOYMENT.md §5` | M |

**DoD:** money path fails over and retries durably; webhook retries run on schedule in prod.

## M9 — KYC live + per-market tiers · `claude/m9-kyc-live`
| Task | What | Tests-first | Files / areas | Est |
|---|---|---|---|---|
| T9.1 | Smile ID **prod** config (base URL, creds via Fly secrets) | unit: prod provider built when `SMILE_ID_SANDBOX=false` | `app.module.ts kycFromEnv`, `DEPLOYMENT.md` | S |
| T9.2 | **Per-market KYC tiers** wired to M3 compliance tiers | e2e: tiered gate per market | `kyc.service.ts`, `escrow.service.ts#release`, compliance adapter | M |
| T9.3 | Controlled live verification round-trip | manual/contract test | Smile ID sandbox→prod | S |

**DoD:** higher-ticket release requires a VERIFIED seller per the market tier; KYC works against prod.

## M10 — Korapay live: keys + egress IP + custody · `claude/m10-korapay-live` 🧩 *(mostly ops/vendor)*
| Task | What | Proof | Owner |
|---|---|---|---|
| T10.1 🧩 | Provision **static/dedicated egress IP** for the API host | `fly ssh … curl ifconfig.me` stable; payout from it | Eng/Ops |
| T10.2 🧩 | Whitelist that IP in Korapay **Live** → Security → IP Whitelisting | live payout no longer 403 | Ops |
| T10.3 🧩 | Set live `KORAPAY_SECRET_KEY` + `KORAPAY_WEBHOOK_URL` (Fly secrets) | live rail enabled | Eng |
| T10.4 🧩 | Get **written** custody (b) no auto-sweep + (d) segregation from Korapay | answers on file | Founders |

**DoD:** a live payout succeeds from the whitelisted IP; custody answers documented. *(See
`korapay-payout-ip-whitelist` memory + `DEPLOYMENT.md §2`.)*

## M11 — Reconciliation + observability · `claude/m11-recon-otel`
| Task | What | Tests-first | Files / areas | Est |
|---|---|---|---|---|
| T11.1 | **Reconciliation report:** ledger vs Korapay balance per currency + drift detection | unit: known ledger vs balance → drift flagged | new `recon/` service + `KorapayRail.getBalances` | M |
| T11.2 | **OpenTelemetry exporter** on the logger/correlation seam | unit: spans/log context exported | `@clairtus/observability`, `correlation.ts` | M |
| T11.3 | **Metrics + alerting** (error rate, queue depth, DLQ, breaker-open, recon drift) | manual: injected fault alerts | exporter + dashboard/alert config | M |

**DoD:** books reconcile to the PSP; production is observable; alerts fire on faults. **→ GATE 2 reached
(with M6–M10 + legal).**

## Legal & regulatory track 🧩 *(parallel, business-owned — gates go-live, not code)*
| Task | What | Proof | Owner |
|---|---|---|---|
| LR-1 🧩 | SA **licensing posture** sign-off (Korapay-as-custodian; no own licence pre-pilot) | counsel memo | Founders/Counsel |
| LR-2 🧩 | **Design-partner contract + DPA** executed | signed agreements | Founders |
| LR-3 🧩 | **KYC/AML program** doc, FICA-aligned; sanctions/PEP plan | program doc | Founders/Compliance |
| LR-4 🧩 | **Data retention / POPIA** windows + deletion + DPA terms | policy doc | Founders/Counsel |

---

# PHASE 3 — Scale, self-serve & polish

*One branch+PR per item; pull any forward on partner demand. Higher-level (UI-heavy) so tasks are coarser.*

| Milestone | Key tasks | Files / areas | Est |
|---|---|---|---|
| **P3.1 Self-serve auth** | Supabase Auth (email/OAuth) signup+login; sessions; team membership; replace pasted-key cookie | `apps/client-dashboard` auth, `/api/connect` rework | L |
| **P3.2 API-key management UI** | Routes + UI: create/list(`last4`)/rotate/revoke/scope; roles (admin/read-only) | new `/v1/keys` endpoints over `@clairtus/tenancy`; dashboard pages | L |
| **P3.3 Dashboard write actions** | Create/manage escrows, parties, webhook endpoints; webhook **replay** UI | dashboard + existing API/replay | L |
| **P3.4 Admin / ops console** | Tenant mgmt, txn monitoring, **dispute workflow** UI (state machine has DISPUTED+resolve) | `admin-panel` (B2B section) | L |
| **P3.5 Marketing + domains** | `clairtus.com` B2B landing; custom domains `app.`/`api.`/`developers.` | `website`, DNS, `DEPLOYMENT.md §9` | M |
| **P3.6 Staging + DR** | Separate staging deploy; backups/DR runbook (RPO/RTO, tested restore); Fly HA | infra, `DEPLOYMENT.md` | M |
| **P3.7 Billing / metering** | Tenant invoicing/settlement/commission off the fee engine | new billing module | L |
| **P3.8 Compliance automation** | Automated sanctions/PEP screening; advanced recon/reporting | compliance + recon | L |

---

## Critical path & dependencies

```
M1 ✅ ──┬─ M2 ── M3 ──┐
        └────────── M4 (needs M2 DTOs)   ── M5 ──►  GATE 1 (Sandbox)
                                                     │
                  M6 ── M7 (needs M6) ── M8 ── M9 ──┤
                  M10 🧩 ─────────────────────────  ┼──►  GATE 2 (Live money)
                  Legal track 🧩 ──────────────────┘   (M11 with first volume)
                                                     │
                  Phase 3 (P3.1…P3.8) ──────────────►  GATE 3 (Self-serve)
```
- **Hard deps:** M4 ⇐ M2 (DTOs feed OpenAPI); M7 ⇐ M6 (webhook reconciles real pay-ins).
- **Parallelizable:** M3 alongside M4; the Legal track runs the whole of Phase 2; M10 (ops/vendor) can
  start early since it's lead-time-bound.
- **Cut order if time slips:** never cut ledger/idempotency/RLS/compliance correctness → cut Phase 3 →
  defer M11 polish → trim Phase 1 to M1–M4 (M5 audit log may trail the first *sandbox* partner but **not**
  live money).

## Definition of Done (every level)
- **Task:** listed tests written-first and passing; typecheck clean; maps to its PR-x.
- **Milestone:** all tasks done; e2e green; docs updated; one PR merged behind green CI.
- **Gate:** the stated success metric in `PRD_FULL.md §8` is demonstrably met.
