# Deep Gap Analysis — Phase 1 & Phase 2 to "100% complete & production-ready"

**Purpose:** an honest, code-level audit of the B2B Escrow infrastructure **after M1–M11**, listing
everything still required to call Phase 1 (Sandbox-ready) and Phase 2 (Live-money) **truly complete and
production-ready**. This goes deeper than [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md) (which
tracks the milestone gaps) — it surfaces **real correctness bugs and hardening gaps found by reading the
code**, with file references.

_Audited: 2026-06-04, post-M11. Assumes PRs #26 (M8) → #27 (M9) → #28 (M11) merged._

**Severity:** 🔴 = blocker before a partner moves **real money** · 🟡 = production-hardening (needed for a
credible live pilot at any scale) · 🟢 = polish / post-pilot.

---

## TL;DR verdict

- **Phase 1 (Sandbox-ready):** functionally complete; remaining items are **hardening** (🟡) + two
  **correctness** issues that also affect sandbox confidence (idempotency race, RLS-as-defense-in-depth).
- **Phase 2 (Live-money):** the happy-path live loop works, but there are **🔴 money-correctness bugs**
  that must be fixed before real funds move — chiefly **payout reversal on late failure**, **idempotency
  under concurrency**, and **posting the actual settled (net-of-fee) amount**. Plus the external
  operator/vendor/legal gates (M10 + legal).

> **Bottom line:** do not move real money until the 🔴 items below are closed. They are small, focused code
> fixes — not redesigns.

---

## A. 🔴 Money-correctness bugs (fix before real money)

### A1. Idempotency is not safe under concurrency (double-execution)
**Where:** `apps/b2b-api/src/common/idempotency.interceptor.ts`.
**Problem:** the interceptor does `SELECT` then runs the handler then `INSERT … ON CONFLICT DO NOTHING`.
Two concurrent requests with the **same** `Idempotency-Key` (double-click, client retry storm, at-least-once
caller) both pass the `SELECT` (no row yet) and **both execute the handler** → a payout/fund can run twice.
The conflict only protects the *response cache*, not the *execution*.
**Fix:** claim the key **before** running the handler — `INSERT … ON CONFLICT DO NOTHING RETURNING` to win a
lock; if no row returned, either wait for/return the cached response or 409 "in progress". (Combined with the
ledger's reference idempotency this is belt-and-suspenders, but `createPayout`/`createEscrow` are not
ledger-idempotent on their own.)

### A2. No payout ledger reversal on a late `transfer.failed`
**Where:** `EscrowService.handleRailEvent` (payout branch) + `createPayout`.
**Problem:** `createPayout` posts the payout to the ledger **optimistically** when the rail returns any
non-`failed` status (incl. `pending`/`processing`). If Korapay later sends `transfer.failed`, the handler
updates the payout status + emits a webhook **but does not reverse the ledger** → the recipient stays
debited while the money never left. **The seller silently loses funds.**
**Fix:** on `transfer.failed`, post a reversing entry (`buildPayoutPosting` reversed, or a ledger `reverse`)
so the recipient is re-credited; make it idempotent on the payout id.

### A3. Pay-in posts the *expected* deposit, not the *actual settled net*
**Where:** `EscrowService.handleRailEvent` (`charge.success`) posts `breakdown.depositAmount` (the escrow's
expected amount).
**Problem:** Korapay credits the balance **net of its fees**, and the buyer could **under/overpay**. Posting
the expected amount means the ledger's held balance ≠ what actually landed → permanent reconciliation drift
and over-stated custody.
**Fix:** post the **actual** settled amount from the webhook (`data.amount` / `data.fee`), and reconcile
fees explicitly (e.g. a `psp_fees` expense account). Decide policy for under/overpayment (reject / partial-fund).

### A4. RLS is not actually enforced (single role bypasses it)
**Where:** `db/schema.ts` (RLS policies exist) + `db/postgres.ts` (API connects as the **table owner**).
**Problem:** the API connects as the owner role, which **bypasses RLS**. So tenant isolation rests entirely
on the service layer remembering a `where tenant_id = $1` on every query — one missed filter = cross-tenant
data leak. The RLS "defense-in-depth" we built is inert in prod.
**Fix:** run the API under a **non-owner role** with `app.current_tenant` set per request (the `withTenant`
toolkit exists in `@clairtus/tenancy`), so RLS is a real backstop. At minimum, add tests asserting every
list/get query is tenant-scoped.

---

## B. 🟡 Production-hardening (needed for a credible live pilot)

### B1. Migrations are full-schema "create if not exists" — no real versioning
**Where:** `db/migrate.ts` → `applyAllSchema` (+ a redundant second `JOB_QUEUE_SCHEMA` apply).
**Gap:** there's no way to **alter** a column, backfill, or roll back; new columns on existing tables won't
apply. Fine for additive v1; needs a real migration tool (or numbered SQL + a `schema_migrations` table)
before the schema evolves. *(Also: dedupe the double job-queue apply.)*

### B2. OpenTelemetry exports almost nothing (no instrumentations registered)
**Where:** `common/tracing.ts` starts `NodeSDK` with only a trace exporter and **no instrumentations**.
**Gap:** without `@opentelemetry/auto-instrumentations-node` (or manual spans around HTTP/DB/rail calls),
the tracer produces near-empty traces. The seam + exporter are wired; **instrumentation is the missing
piece**.

### B3. Reconciliation doesn't model PSP held/pending balance or fees
**Where:** `recon/reconciliation.service.ts` compares ledger custody vs the rail's **available** balance.
**Gap:** Korapay holds collected funds as **pending** until settled and deducts **fees**; comparing to
`available` only will show drift even when correct. Reconcile against `available + pending` and account for
fees (ties into A3).

### B4. Audit log isn't transactional with the money operation
**Where:** `EscrowService` awaits `audit.record(...)` *after* the ledger post/webhook.
**Gap:** if the audit insert fails (or the process dies between), the money op happened with **no audit
row** — breaking "every money op is audited". Write the audit row in the **same transaction** as the
ledger post.

### B5. Rate limiting is in-memory (per-instance, resets on deploy)
**Where:** `@nestjs/throttler` default storage.
**Gap:** not shared across instances and lost on restart; ineffective under HA or as durable abuse
protection. Back it with Redis/Postgres or an edge limiter for prod.

### B6. No partial release / milestone payouts (a core PRD use case)
**Where:** core state machine has no `PARTIALLY_RELEASED`; `release()` is **full-only**.
**Gap:** gig/services marketplaces (the #1 target segment in `PRD.md`) need **milestone/partial releases**.
Today an escrow releases 100% or nothing. This is a functional gap in "full lifecycle".

### B7. Single Fly machine, no staging, backups/DR untested
**Gaps:** SPOF (no HA); sandbox is a *mode*, not a separate **staging** deploy; Supabase backups are
default with **undocumented RPO/RTO and no tested restore**.

### B8. Inbound/outbound webhook robustness
**Gaps:** outbound delivery has retry+DLQ (good) but no documented **receiver dedupe/ordering** guidance and
no enforced HTTPS on tenant endpoints; inbound concurrent duplicate `charge.success` is saved by ledger
reference idempotency but can double-emit the outbound `escrow.funded`.

### B9. Compliance/AML completeness
**Gaps:** no automated **sanctions/PEP** screening; structuring is flagged but not actioned (no
case/queue); volume counts **created** escrows (not funded), which can over-count; no documented FICA program.

### B10. Operational surfaces missing for a live pilot
**Gaps:** no **dispute-resolution** operational workflow/console (the state supports it; the process/UI
doesn't); `/v1/system/metrics` exposes global counts to any authenticated tenant (minor info leak — move
to an ops-scoped key or internal port).

---

## C. 🟢 Polish / post-pilot
- Enrich OpenAPI response schemas (request bodies done; responses are still thin).
- CORS policy if any browser-side clients are added (today the dashboard calls server-side).
- Secrets policy: adopt a manager + rotation cadence (PATs/DB creds were rotated ad-hoc).
- Load/performance testing; ledger partitioning path; read replicas.
- Lint (the `turbo run lint` task is a no-op — add ESLint).

---

## D. External gates (not code — owner/vendor/legal)
- **M10 (ops/vendor):** Korapay **live keys**, **static egress IP** + Live-mode allowlist, written custody
  **(b)** no-auto-sweep + **(d)** segregation answers.
- **Operator config:** `FLY_API_TOKEN`, `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, live Smile ID creds
  (`SMILE_ID_SANDBOX=false`); schedule the `webhook-worker` + `reconcile`; publish the SDK; host
  `developers.clairtus.com`.
- **Legal:** SA escrow/licensing-posture sign-off; design-partner contract + DPA; FICA/AML program; POPIA
  retention/DPA.

---

## E. "Definition of 100% complete" checklists

**Phase 1 — Sandbox design-partner ready (100%):**
- [ ] A1 idempotency race fixed · [ ] A4 RLS enforced (or explicit tenant-scoping tests)
- [ ] B4 audit transactional · [ ] B2 OTel instrumentations (or accept errors-only)
- [x] Scopes / required idempotency / throttling / validation (M2)
- [x] Compliance limits + KYC tiers (M3/M9) · [x] SDK/docs/OpenAPI/pagination (M4) · [x] audit log + Sentry (M5)
- [ ] SDK published + docs hosted (operator)

**Phase 2 — Live-money pilot ready (100%):**
- [ ] **A2 payout reversal on failure** · [ ] **A3 post actual settled net + fees** · [ ] A1 idempotency
- [ ] B1 versioned migrations · [ ] B3 reconciliation models pending+fees · [ ] B6 partial release (if a
      milestone partner) · [ ] B7 HA + staging + tested restore
- [x] Real pay-in (M6) · [x] inbound webhook (M7) · [x] router + queue/DLQ + worker (M8) · [x] recon + OTel + metrics (M11)
- [ ] M10 Korapay live + egress IP + custody (vendor) · [ ] Legal sign-off · [ ] KYC live creds (operator)

> Recommended order before a live pilot: **A2 → A3 → A1 → A4 → B1 → B3**, then the external gates.
> These are focused fixes; none require re-architecting the ledger or the rail/queue design.
