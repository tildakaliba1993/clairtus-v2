# Ultimate Gap Analysis — Clairtus B2B Escrow (single source of truth)

**Everything still required to be fully production-ready and to onboard real-money pilots.** Consolidates
and supersedes `GAP_ANALYSIS_PHASE1_2.md`. Read with [`STATE_OF_BUILD.md`](STATE_OF_BUILD.md) (what
exists). _Updated 2026-06-06, post-Phase-3._

**Severity:** 🔴 = blocker before **real money** moves · 🟡 = production-hardening · 🟢 = polish/post-pilot ·
🧩 = external (operator/vendor/legal, not code).

> **Recommended order before a live pilot:** fix **A1 → A2 → A3 → A4** (small, focused; protect money),
> then **B1, B3**, then the 🧩 external gates. None require re-architecting the ledger/rail/queue.

---

## 0. ⚠️ Unmerged code (do first)
- **PR #35** (`claude/dashboard-runtime-supabase`, commit `067b6a1`) — the **singleton Supabase client +
  session-driven auto-provision** fix. #34 merged only the runtime-config commit; the actual fix for
  "Supabase user created but no Clairtus tenant" is **NOT in `main`**. **Merge #35.**

## A. 🔴 Money-correctness bugs (fix before real money)

### A1. Idempotency is not concurrency-safe (double-execution)
`common/idempotency.interceptor.ts` does `SELECT` → run handler → `INSERT … ON CONFLICT DO NOTHING`.
Two concurrent same-key requests both pass the SELECT and **both execute** (double payout/fund). The
conflict only protects the cached response. **Fix:** claim the key *before* running the handler (insert
a "pending" row with the unique (tenant,key) → if you didn't win, wait/return cached or 409).

### A2. No payout ledger reversal on a late `transfer.failed`
`EscrowService.handleRailEvent` (payout branch) updates status + webhook **but doesn't reverse the
ledger**. `createPayout` posts optimistically on any non-`failed` status (incl. `pending`). A later
`transfer.failed` ⇒ recipient stays debited while money never left ⇒ **seller silently loses funds.**
**Fix:** on `transfer.failed`, post a reversing entry (idempotent on payout id); re-credit `recipient_payable`.

### A3. Pay-in posts the *expected* deposit, not the *actual settled net*
`handleRailEvent` (`charge.success`) posts `breakdown.depositAmount` (expected), but Korapay credits
**net of fees** and the buyer can under/overpay. ⇒ permanent ledger↔PSP drift + overstated custody.
**Fix:** post the **actual** settled amount from the webhook (`data.amount`/`data.fee`); model fees
(e.g. a `psp_fees` account); decide under/overpayment policy.

### A4. RLS is inert (API connects as table owner)
RLS policies exist but the API connects as the **owner role** (bypasses RLS) ⇒ isolation rests entirely
on service-layer `where tenant_id` — one missed filter = cross-tenant leak. **Fix:** run under a
non-owner role with `app.current_tenant` per request (`withTenant` exists), or at minimum add tests
asserting every query is tenant-scoped. (Note: `handleRailEvent` queries by id across tenants — that's
correct, it's system-level.)

## B. 🟡 Production-hardening

- **B1. ✅ Versioned migration runner** (`db/migrations.ts`) — forward-only migrations tracked in
  `schema_migrations`, each applied atomically with its marker; `0001_baseline` is the v1 schema (all
  `create … if not exists`, safe no-op on the live DB). `migrate()` delegates to the runner; the double
  `JOB_QUEUE_SCHEMA` apply is deduped. Future schema changes: append `0002_…` with ALTER/backfill.
- **B2. OpenTelemetry exports little** — `common/tracing.ts` starts `NodeSDK` with **no instrumentations**.
  Add `@opentelemetry/auto-instrumentations-node` (or manual spans) so traces aren't near-empty.
- **B3. Reconciliation ignores PSP pending balance + fees** — `recon` compares ledger vs **available**
  only; Korapay holds funds as **pending** + deducts fees ⇒ false drift. Reconcile `available+pending`
  and fees (ties to A3).
- **B4. Audit log not transactional with the money op** — `audit.record` is awaited *after* the ledger
  post; a crash/failure between ⇒ money op with no audit row. Write it in the same transaction.
- **B5. Rate limiting is in-memory** (`@nestjs/throttler` default store) — per-instance, resets on deploy,
  useless under HA. Back with Redis/Postgres or an edge limiter.
- **B6. No partial release / milestone payouts** — core has no `PARTIALLY_RELEASED`; `release()` is
  full-only. Gig/services marketplaces (the #1 PRD segment) need milestones. Functional gap.
- **B7. Single Fly machine (no HA); no staging; backups/DR untested** — sandbox is a *mode*, not a deploy.
  Document RPO/RTO + test a restore; add Fly HA.
- **B8. Self-serve returning-user reconnect** — a returning user with a tenant but no key cookie can't get
  into the dashboard (`/api/signup` returns no key; `/keys` → requireKey → /connect dead-end). Proper fix:
  make the **API accept the Supabase session JWT** for tenant reads (a session-auth fallback in
  `ApiKeyGuard`/a parallel guard), so the dashboard needs no key paste. (Code stub: `tenant_users` + the
  `AuthVerifier` already exist; wire the guard.)
- **B9. AML completeness** — no automated **sanctions/PEP** screening; structuring is flagged but not
  actioned (no case queue); compliance volume counts **created** (not funded) escrows.
- **B10. Webhook robustness** — outbound has retry+DLQ (good); inbound concurrent duplicate `charge.success`
  is saved by ledger-reference idempotency but can double-emit the outbound `escrow.funded`. Document
  receiver dedupe; enforce HTTPS endpoints.
- **B11. ✅ `/system/metrics` scoped to operators** — the endpoint now requires the operator-only
  `ops:read` scope (not in `DEFAULT_WRITE_SCOPES`), so a standard tenant key gets 403; mint an ops key
  with `ops:read` for monitoring/alerting. No more system-wide counts leaking to any authenticated tenant.

## C. 🟢 Polish / post-pilot
OpenAPI **response** schemas still thin (request bodies done) · add **ESLint** (`turbo run lint` is a
no-op) · CORS policy if browser clients are added · secrets manager + rotation cadence · load/perf
testing · ledger partitioning/read replicas · Supabase Auth: OAuth providers, team membership + roles.

## D. 🧩 External gates (not code — owner/vendor/legal)
- **M10 (vendor/ops):** Korapay **live keys**, **static/dedicated egress IP** + Live-mode allowlist
  (payouts 403 without it), written custody **(b)** no-auto-sweep + **(d)** segregation. Smile ID prod creds.
- **Operator config:** `FLY_API_TOKEN`; `SENTRY_DSN`; `OTEL_EXPORTER_OTLP_ENDPOINT`; **API `SUPABASE_URL`**;
  **dashboard `SUPABASE_URL`+`SUPABASE_ANON_KEY`** (then redeploy; verify `/api/auth-config`); Supabase
  Auth → enable Email + (for instant signup) **turn off "Confirm email"** or set Site/Redirect URLs;
  schedule the `webhook-worker` + `reconcile`; publish `@clairtus/sdk` to npm; host `developers.clairtus.com`.
- **Legal:** SA escrow/licensing-posture sign-off (Korapay-as-custodian avoids own licence pre-pilot) ·
  design-partner **contract + DPA** · FICA/AML program · POPIA retention.

## E. Phase-3 surfaces still to build (post the above)
- Self-serve **OAuth** + **team membership/roles** + returning-user session reconnect (B8).
- **Dashboard write actions** (create/manage escrows, parties, webhook endpoints; webhook replay UI).
- **Admin / ops console** + **dispute-resolution workflow** UI (state machine has DISPUTED + resolve).
- **B2B marketing site** (`clairtus.com`) + **custom domains** (`app.`/`api.`/`developers.`).
- **Billing / metering** (tenant invoicing/commission off the fee engine).

## F. "100% complete" gates
- **Sandbox-ready (Phase 1):** ✅ M1–M5 done. Close A1, A4, B4 for full confidence.
- **Live-money-ready (Phase 2):** ✅ M6–M11 code done. **Must close A2, A3, A1, A4** + M10 (vendor) +
  legal sign-off + B1/B3 before real funds.
- **Self-serve (Phase 3):** signup ✅ (merge #35); key-mgmt UI ✅; remaining: B8 + admin/marketing/billing.
