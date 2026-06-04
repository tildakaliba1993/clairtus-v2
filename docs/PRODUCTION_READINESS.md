# Production Readiness — Gap Analysis

**Purpose:** an honest assessment of what the B2B Escrow MVP **is** vs. what it still **needs** to be a
production-ready, **self-serve** escrow infrastructure ready to onboard design partners. This drives the
next sprint. Read with `PROGRESS.md` (build state) + `ARCHITECTURE.md` + `IMPLEMENTATION_PLAN.md`.

_Last updated: 2026-06-04, immediately after first live deploy._

---

## ✅ What is built & LIVE today

- **API** (`apps/b2b-api`, NestJS) live on Fly.io → `https://clairtus-api.fly.dev` (Johannesburg, always-on,
  health-checked, auto-migrating on release; runs under the SWC runtime so DI works).
- **Database**: Supabase Postgres (Frankfurt), full schema migrated (tenants, api_keys, ledger, escrows,
  parties, payouts, events, webhooks, kyc_checks, idempotency_keys, jobs).
- **Dashboard** (`apps/client-dashboard`, Next 16) live on Vercel → tenant logs in with an API key and sees
  balances / escrows / payouts / webhook deliveries (design-system matched).
- **Domain logic** (all unit/integration tested, ~190 tests): double-entry ledger, fee/split engine, escrow
  state machine, per-market compliance engine, payment-rail abstraction (PawaPay + Korapay + simulated),
  KYC (Smile ID) abstraction, tenancy + RLS, signed outbound webhooks, durable queue + circuit breaker, SDK.
- **Sandbox works end-to-end now**: a test key drives create → fund → release → payout (simulated rail).
- **Custody (Korapay)**: collect-into-balance (a) and disburse-on-trigger (c) **proven on sandbox**.

> **Bottom line:** a design partner could begin a **sandbox** integration soon. **Real-money go-live needs
> the 🔴 items below.** Severity: 🔴 = blocker before a partner moves real money · 🟡 = needed for a credible
> self-serve pilot · 🟢 = post-MVP.

---

## 1. Real money movement (the core escrow function)

- ✅ **Real pay-in collection (done, Track B M6).** In **live mode with a rail configured**,
  `POST /v1/escrows/:id/fund` now initiates a Korapay collection, persists a `payins` intent, returns
  payment instructions, and leaves the escrow at `AWAITING_FUNDING` — it does **not** post to the ledger
  until the funds land (via the inbound webhook, M7). Test mode keeps the synchronous sandbox flow.
- ✅ **Inbound rail webhook handler (done, Track B M7).** Public, HMAC-verified `POST /v1/webhooks/korapay`
  → `parseWebhook` → `NormalizedEvent` → drives the lifecycle: `charge.success` funds the escrow
  (AWAITING_FUNDING → FUNDED + ledger post) **exactly once** (idempotent on re-delivery), `charge.failed`
  marks the pay-in failed, `transfer.success/failed` reconciles the payout + fires the outbound webhook.
  Forged signature → 401; unknown event → 200-ignored (no retry storm).
- 🔴 **Korapay custody (b) + (d) unconfirmed in writing** — no forced auto-sweep over a multi-day hold, and
  how pooled balance funds are treated/segregated. (T2.3 left these open; get it in writing.)
- 🔴 **Live rail not wired in prod**: `KORAPAY_SECRET_KEY` not set on Fly; payouts only work in sandbox.
- 🔴 **Static egress IP for Korapay Live** not provisioned/whitelisted — live payouts will 403 without it
  (proven in E2/T2.3). Fly machines share egress IPs; need a dedicated/static egress + Korapay allowlist.
- ✅ **Payouts via RailRouter (done, Track B M8).** `createPayout` disburses through a per-mode
  `RailRouter.run()` — circuit breaker + failover now in the money path. If every eligible rail is down,
  the payout is **enqueued for durable retry** (queue + DLQ) and funds aren't moved until a dispatch succeeds.
- ✅ **Reconciliation report (done, Track B M11).** `ReconciliationService` + `reconcile` script compare
  ledger custody (`escrow_held + recipient_payable`) against the PSP balance per currency and flag drift
  (exits non-zero for alerting). Run on a schedule.
- 🟢 Multi-currency / live FX in B2B flows; per-transaction segregated virtual accounts (Fincra).

## 2. Self-serve onboarding & authentication

- 🔴 **No self-serve signup.** Tenants are created by an operator CLI (`pnpm … onboard`). A self-serve
  product needs partner sign-up + tenant provisioning.
- 🔴 **Dashboard has no real auth** — it only "remembers" a pasted API key in a cookie. Needs tenant **user
  accounts** (Supabase Auth: email/OAuth), sessions, and team membership.
- 🟡 **API-key management API done (Phase 3 P3.1); UI pending.** `GET/POST /v1/keys` + `POST /v1/keys/:id/revoke`
  (scoped `keys:read`/`keys:write`, tenant-isolated, audited; plaintext returned once) + SDK `apiKeys.*`. The
  dashboard **UI** (and self-serve signup) that consume these are P3.2.
- 🟡 **No roles/permissions** within a tenant (admin vs read-only).

## 3. Security hardening

- 🔴 **API-key scopes are NOT enforced.** Keys carry scopes (`escrows:write`, …) but no guard checks them
  per route — every valid key can do everything. Add a `@Scopes()` decorator + check in `ApiKeyGuard`.
- 🔴 **Idempotency is optional, not required.** The interceptor only acts when an `Idempotency-Key` header is
  present; money-moving POSTs should **require** it (architecture mandates this).
- 🔴 **No rate limiting / throttling** (abuse + brute-force protection). Add `@nestjs/throttler` or edge limits.
- 🟡 **Thin input validation** — handlers do manual checks; no `class-validator`/`ValidationPipe`, so malformed
  payloads aren't consistently rejected with 422.
- ✅ **Immutable audit log (done, Track A M5)** — append-only `audit_log` written on every money operation
  (escrow create/fund/release/refund/cancel/dispute, payout) + admin actions (tenant/key issuance), via
  `AuditService`; queryable by tenant + escrow. Never updated/deleted (architecture §14).
- 🟡 **Secrets hygiene**: a DB password and a GitHub PAT were exposed during setup and **rotated** — adopt a
  secrets policy (managers only, never in logs/chat). CORS is unset (fine while the dashboard calls server-side).

## 4. Compliance (regulatory engine)

- ✅ **Compliance engine wired (done, Track A M3).** `@clairtus/compliance` is now imported by `apps/b2b-api`
  via a `ComplianceService`: escrow **create** is gated on per-market amount bounds + cumulative daily/monthly
  volume (422 on violation), structuring is flagged, and every decision is recorded in `compliance_decisions`
  (feeds the M5 audit log). Markets: SA (FICA-aligned basics, env-tunable) + DRC BCC. Amounts convert minor
  units → USD via a configurable FX table.
- ✅ **KYC live-ready (done, Track B M9).** Per-market KYC **tiers** (USD, falling back to the global
  threshold) gate higher-ticket releases — verified end-to-end. The Smile ID provider switches to
  **production** with `SMILE_ID_SANDBOX=false` (`kycProviderFromEnv`, unit-tested). *Operator action:*
  set the live Smile ID `SMILE_ID_PARTNER_ID` / `SMILE_ID_API_KEY` + `SMILE_ID_SANDBOX=false` on Fly.
- 🟡 **No AML / sanctions / PEP screening**; no FICA (SA) program documented.
- 🟡 **Data retention / POPIA-GDPR** (retention windows, deletion, DPA) not addressed.

## 5. Reliability & operations

- ✅ **Background worker (done, Track B M8).** The `webhook-worker` now drains **both** due webhook
  deliveries **and** the durable payout-dispatch queue; supports `--loop` for a single always-on Fly
  machine (see `DEPLOYMENT.md §5`). *(Operator: provision the scheduled/always-on machine.)*
- ✅ **Durable queue + DLQ wired (done, Track B M8).** `@clairtus/queue` now backs **payout dispatch**
  when rails are unavailable (retry with backoff → dead-letter after max attempts); the jobs table is
  part of the prod schema/migrations.
- ✅ **Observability (done, Track B M11).** Structured logs + correlation IDs; **Sentry** (M5); an
  **OpenTelemetry** OTLP tracer that activates when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (no-op otherwise);
  and a **`GET /v1/system/metrics`** surface (payout-queue depth/DLQ, webhook backlog) for scraping +
  **alerting** (plus the reconciliation drift exit-code). *Operator: point OTEL at a collector + wire alerts.*
- ✅ **CI/CD (done, Track A M1)** — `.github/workflows/ci.yml` runs typecheck + the full test suite
  (packages + apps) on every PR into `main`; `deploy.yml` re-verifies then `flyctl deploy --ha=false` on
  push to `main` (skips gracefully until `FLY_API_TOKEN` is set). Lint is a no-op until a linter is added.
- 🟡 **No staging environment** — only production (sandbox is a *mode*, not a separate deploy).
- ✅ **Readiness vs liveness (done, Track A M1)** — `/v1/health` stays static (liveness; Fly's machine
  check uses it so a DB blip can't flap the node); new `GET /v1/ready` pings the DB → `503` when unreachable.
- 🟡 **Backups / DR** — rely on Supabase defaults; document RPO/RTO and test restore. Single Fly machine (no HA).

## 6. API & developer experience

- ✅ **Cursor pagination (done, Track A M4)** — `escrows`/`payouts`/`ledger` now accept `?limit&cursor` and
  return `{ data, nextCursor }` (opaque, insert-stable). The SDK exposes `{ limit, cursor }` → `Page<T>`.
- ✅ **OpenAPI enriched (done, Track A M4)** — DTOs are decorated classes (`@ApiProperty`); `/docs` shows real
  request schemas, grouped by tag, with the bearer scheme. `openapi:export` dumps the spec for a docs site.
- ✅ **SDK publish-ready (done, Track A M4)** — `@clairtus/sdk` builds to `dist` (ESM + `.d.ts`) with
  `publishConfig`; `npm publish` is a one-command operator step (needs the npm token). README + CHANGELOG added.
- ✅ **Docs hosting ready (done, Track A M4)** — runbook in `DEVELOPER_DOCS.md` + spec export; deploying
  `developers.clairtus.com` (Redoc on Vercel + DNS) is the remaining operator step.
- 🟡 **Webhook endpoint management** — partners can't register/view/replay webhook endpoints from the dashboard
  (only the delivery log is shown). *(Phase 3.)*

## 7. Product surfaces

- 🟡 **Dashboard is read-only** — no create/manage actions (escrows, parties, keys, webhooks) from the UI.
- 🟡 **No B2B marketing site** — `clairtus.com` still serves the B2C/DRC (French) site; B2B landing not built.
- 🟡 **No B2B admin/ops console** — dispute resolution, tenant management, transaction monitoring (the
  `admin-panel` app serves B2C ops only).
- 🟡 **Dispute workflow** — the escrow has `DISPUTED` + resolve transitions, but no operational dispute process/UI.
- 🟢 **Billing / metering** — fee engine computes fees, but no tenant invoicing/settlement/commission payout.

## 8. Legal & regulatory (business, gates go-live)

- 🔴 **Escrow/licensing posture (SA)** — the model assumes Korapay (licensed PSP) holds funds and Clairtus only
  orchestrates. **Confirm with counsel** that this avoids needing Clairtus's own EME/PSP/escrow-agent licence
  pre-pilot. This is a fundamental go-live gate.
- 🔴 **Design-partner contracts + DPA** before live funds.
- 🟡 **KYC/AML program** documentation aligned to FICA (SA).

## 9. Custom domains (deferred from deploy)

- 🟡 Map `clairtus.com` (marketing), `app.clairtus.com` (dashboard), `api.clairtus.com` (API). Dashboard
  currently points at `clairtus-api.fly.dev`; switch `CLAIRTUS_API_URL` after DNS. (See `DEPLOYMENT.md`.)

---

## Recommended next sprint (ordered)

**Track A — make a SANDBOX design-partner pilot real (fast, low risk):**
1. Enforce **scopes** + **required idempotency** on money POSTs; add **rate limiting** + input validation.
2. ✅ Wire the **compliance engine** into escrow create/release (limits + KYC tiers per market) — DONE (M3).
3. **Self-serve auth + API-key management** in the dashboard (Supabase Auth) — or accept manual onboarding for
   partner #1 and prioritize this for #2+.
4. ✅ **Publish the SDK** + host **docs** + enrich OpenAPI + cursor pagination — DONE (M4); SDK `npm publish`
   and `developers.clairtus.com` DNS are the remaining one-step operator actions (runbook in `DEVELOPER_DOCS.md`).
5. ✅ **CI/CD** (GitHub Actions: typecheck/test on PR; deploy on merge) + **readiness check** — DONE (M1).
   ✅ **error tracking** (Sentry) + **immutable audit log** — DONE (M5); set `SENTRY_DSN` to activate Sentry.

**Track B — unlock REAL money (heavier, partly external):**
6. ✅ **real pay-in collection** (Korapay charge) — DONE (M6); **inbound rail webhook handler** (M7) drives
   the lifecycle to `FUNDED` when the charge settles.
7. ✅ Route **payouts through `RailRouter`** (failover + breakers) + **durable queue + DLQ** + the worker that
   webhook worker.
8. **Korapay live**: confirm custody (b)/(d) in writing, set live keys, provision **static egress IP** + allowlist.
9. **Legal**: licensing posture sign-off + partner contracts/DPA; audit log; AML/FICA basics.
10. Custom domains + B2B marketing/admin surfaces.

**Definition of "design-partner ready (sandbox)":** Tracks A1–A4 done.
**Definition of "pilot-live ready (real money)":** Track B6–B9 done.
