# State of Build — Clairtus B2B Escrow Infrastructure

**An exhaustive inventory of everything built.** Snapshot after the M1–M11 + Phase-3 sprint.
_Last updated: 2026-06-06._ Pair with [`SESSION_HANDOFF.md`](SESSION_HANDOFF.md) (resume prompt) and
[`GAP_ANALYSIS_ULTIMATE.md`](GAP_ANALYSIS_ULTIMATE.md) (what's left).

> **Verdict:** the full escrow lifecycle works end-to-end (sandbox + real-money code paths), behind
> enforced scopes / idempotency / rate-limits / per-market compliance / KYC tiers, with real pay-in
> collection, an inbound rail webhook that drives funding, payouts through the router with a durable
> retry queue + DLQ, an immutable audit log, reconciliation, Sentry + OTel hooks, a typed SDK, an
> API-key-management UI, and self-serve signup. **~205 tests pass; the whole monorepo typechecks.**

---

## 1. Repo, stack, tooling
- **Repo:** `tildakaliba1993/clairtus-v2` (private). Work happens in
  `/Users/cash/clairtus-v2` (and git worktrees under `.claude/worktrees/`).
- **Stack:** TypeScript end-to-end · pnpm + Turborepo monorepo · **NestJS** B2B API · **Next 16**
  dashboard · Postgres (Supabase) · Fly.io (API) + Vercel (Next apps).
- **Commands:** `corepack pnpm …` (plain pnpm not on PATH). Node 22.
  - Test: `corepack pnpm -r --filter "./packages/*" --filter "./apps/*" test` (pglite + jsdom; **no Docker**).
  - Typecheck: same filters with `typecheck`.
- **API runtime:** runs under the **SWC runtime** (`@swc-node/register`) so NestJS DI metadata is emitted
  — **never switch the API/scripts to tsx** (DI + `@ApiProperty`/OpenAPI break). Scripts that use DI
  (`start`, `webhook-worker`, `openapi:export`, `reconcile`) all use the SWC loader.
- **Tests use `unplugin-swc`** (vitest) for decorator metadata.

## 2. Packages (`packages/*`)
| Package | What |
|---|---|
| `@clairtus/shared` | `Money` (integer minor units) + arithmetic + `applyBps`. |
| `@clairtus/core` | Escrow state machine (`applyEscrowEvent`), fee/split (`computeFeeBreakdown`), escrow→ledger posting builders (`buildFundPosting`/`buildReleasePosting`/`buildRefundPosting`/`buildPayoutPosting`). |
| `@clairtus/ledger` | Double-entry ledger (accounts/entries/posting groups), `post` (atomic+balanced), `getBalance`, `reverse`, idempotency on reference. Account types: `escrow_held`, `recipient_payable`, `tenant_payable`, `clairtus_revenue`, `psp_fees`, `external`. |
| `@clairtus/compliance` | Per-market limit engine: `checkAmountBounds`, `checkVolumeLimits`, `isStructuring`, `toUsd/fromUsd`, `BCC_RULES`. (Works in USD/major; the API converts minor→USD.) |
| `@clairtus/payments` | `PaymentRail` interface + `NormalizedEvent` + **`RailRouter`** (`run` w/ failover) + **`CircuitBreaker`** + adapters: **PawaPay** (DRC), **Korapay** (SA/NG pay-in + payout-from-balance + webhook HMAC + `getBalances`), **SimulatedRail** (sandbox). |
| `@clairtus/kyc` | `KycProvider` + **Smile ID** adapter. |
| `@clairtus/tenancy` | Tenants + hashed test/live API keys (`createTenant`, `issueApiKey`, `authenticate`, `revokeApiKey(id, tenantId?)`, **`listApiKeys`**) + Postgres RLS toolkit (`tenantRlsSql`, `withTenant`). |
| `@clairtus/queue` | Durable `JobQueue` over Postgres: enqueue/claim/complete/fail (backoff) → **DLQ** (`dead`) after max attempts; `process`, `stats`. |
| `@clairtus/observability` | Structured JSON logger + correlation id (AsyncLocalStorage): `getCorrelationId`, `runWithCorrelationId`. |
| `@clairtus/sdk` | Typed client (`ClairtusClient`): parties/escrows/payouts/kyc/balances/ledger/webhooks/**apiKeys** + `verifyWebhookSignature`. **Auto-idempotency** on money POSTs. Cursor pagination (`Page<T>`). **Publish-ready** (`dist` ESM+`.d.ts` via `tsconfig.build.json` + `publishConfig`), v0.1.0, README + CHANGELOG. |

## 3. Apps (`apps/*`)
### `apps/b2b-api` (NestJS) — live on Fly `clairtus-api.fly.dev`
**Cross-cutting (all global via `app.module`):** `ApiKeyGuard` (authn + **scope** check → 403),
`ApiKeyThrottlerGuard` (per-key rate limit → 429), `IdempotencyInterceptor` (caches + **requires**
`Idempotency-Key` on money POSTs → 400), `HttpErrorFilter` (one envelope `{error:{code,message,statusCode}}`
+ Sentry capture), global `ValidationPipe` (422), `correlationMiddleware`.

**Endpoints (`/v1`):**
- Health: `GET /health` (static liveness), `GET /ready` (DB ping → 503), `GET /system/metrics` (queue/DLQ/webhook backlog, authed).
- Escrows: `POST /escrows` (compliance-gated create) · `GET /escrows` (cursor) · `GET /escrows/:id` · `POST /escrows/:id/{fund,release,refund,cancel,dispute}` (scoped + idempotency-required on fund/release/refund).
- Parties: `POST /parties` · `GET /parties/:id`.
- Payouts: `POST /payouts` (router + breaker; enqueues durable retry if all rails down) · `GET /payouts` (cursor) · `GET /payouts/:id`.
- Money views: `GET /balances` · `GET /ledger` (cursor).
- KYC: `POST /kyc/checks` · `GET /kyc/checks/:id` · `POST /kyc/callback` (public, signed).
- Webhooks: `POST /webhook-endpoints` · `GET /webhook-deliveries` · `POST /webhook-deliveries/:id/replay` · **`POST /webhooks/korapay`** (public, HMAC-verified inbound rail → drives lifecycle).
- Keys: `GET /keys` · `POST /keys` (plaintext once) · `POST /keys/:id/revoke` (tenant-isolated). Scopes `keys:read/keys:write`.
- Auth (self-serve, session-JWT not API-key): `POST /auth/signup` · `GET /auth/me`.
- Docs: `/docs` (Swagger), `/docs-json`.

**Scripts (`pnpm --filter @clairtus/b2b-api …`):** `migrate`, `webhook-worker [--loop]` (drains webhook
deliveries + the `payout.dispatch` queue), `openapi:export`, `reconcile`, `onboard`, `demo`.

### `apps/client-dashboard` (Next 16) — live on Vercel
Pages: overview, escrows (list+detail), payouts, webhooks, **keys** (KeyManager: create/list/revoke),
**signup** (Supabase Auth). API routes: `/api/connect`, `/api/disconnect`, `/api/keys[, /[id]/revoke]`,
`/api/signup`, `/api/auth-config` (runtime Supabase config + diagnostic). Server components use the SDK
with the key from an httpOnly cookie (never reaches the browser).

### In-place (not in `apps/`): `website/`, `admin-panel/` (B2C ops), `supabase/functions` (live DRC WhatsApp).

## 4. Database tables (all via `applyAllSchema` / `migrate`)
`tenants`, `api_keys`, `tenant_users` (auth-user→tenant), ledger (`ledger_accounts`, `ledger_entries`,
`ledger_posting_groups`), `idempotency_keys`, `jobs` (durable queue), `parties`, `escrows`, **`payins`**,
`payouts`, `events`, `webhook_endpoints`, `webhook_deliveries`, `kyc_checks`, `compliance_decisions`,
`audit_log`. RLS policies exist on tenant tables (but the API runs as table **owner** → see gap A4).

## 5. Milestones shipped (all merged to `main`)
| | PR |
|---|---|
| **M1** CI/CD (GH Actions) + `/v1/ready` | #18 |
| Planning docs (PRD_FULL, DELIVERY_PLAN, IMPLEMENTATION_TASKS) | #19 |
| **M2** API hardening (scopes, required idempotency, throttle, validation/DTOs) | #20 |
| **M3** Compliance engine wired (per-market bounds/volume/structuring + KYC tiers) | #21 |
| **M4** SDK publish-ready + OpenAPI enriched + cursor pagination + docs runbook | #22 |
| **M5** Immutable audit log + Sentry | #23 |
| **M6** Real pay-in collection (Korapay charge, live mode) | #24 |
| **M7** Inbound rail webhook handler (drives funding/payout reconcile) | #25 |
| **M8** Payouts via RailRouter + durable queue/DLQ + worker | #26 |
| Deep gap analysis (`GAP_ANALYSIS_PHASE1_2.md`) | #29 |
| **M9** KYC live-ready (prod provider config + per-market tier verification) | #27 |
| **M11** Reconciliation + OTel + `/system/metrics` | #28 |
| **P3.1** API-key management endpoints | #30 |
| **P3** Key-management UI | #31 |
| **P3.2** Self-serve signup (JWT provisioning + dashboard) | #32 |
| Auth JWKS (ES256/RS256 verification) | #33 |
| Dashboard runtime Supabase config + `/api/auth-config` | #34 |
| **⚠️ Dashboard singleton + session-driven provisioning** | **#35 — OPEN/unmerged** |

## 6. Test counts (all green)
b2b-api ~109 · client-dashboard 12 · core 28 · payments 44 · shared 12 · compliance 13 · ledger 7 ·
tenancy 10 · kyc 9 · queue 5 · observability 4 · sdk 5. Whole monorepo typechecks.

## 7. Deploy / live URLs
- **API:** `https://clairtus-api.fly.dev` (Fly app `clairtus-api`, region `jnb`; `/v1/health`, `/docs`). SWC runtime. Schema auto-migrates on release.
- **Dashboard:** `https://clairtus-v2-client-dashboard.vercel.app` (Vercel; connect with a `ck_test_` key, or `/signup`).
- **DB:** Supabase project `clairtus-b2b` (ref `uhgdewebkqqrlnxkuzaz`, Frankfurt/eu-central-1). `DATABASE_URL` = Fly secret (txn pooler :6543, `prepare:false`). **Supabase Auth uses ECC P-256 (ES256) signing keys.**
- CI gates PRs; deploy-on-merge to Fly needs repo secret `FLY_API_TOKEN`.

## 8. Env vars (see `DEPLOYMENT.md` for the full table)
API: `DATABASE_URL`(✅), `KORAPAY_SECRET_KEY`/`KORAPAY_WEBHOOK_URL`, `SMILE_ID_*`+`SMILE_ID_SANDBOX=false`,
`KYC_RELEASE_THRESHOLD`, `THROTTLE_LIMIT/TTL`, `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
`FICA_*`/`FX_*`/`KYC_THRESHOLD_*_USD`/`STRUCTURING_THRESHOLD`, `RECON_TOLERANCE_MINOR`, **`SUPABASE_URL`** (JWKS).
Dashboard (Vercel): `CLAIRTUS_API_URL`, **`SUPABASE_URL`** + **`SUPABASE_ANON_KEY`** (runtime, no NEXT_PUBLIC needed).

## 9. Operator/vendor/legal items NOT done (block real money)
Korapay **live keys** + **static egress IP** + custody (b)/(d) written sign-off (M10) · Smile ID prod
creds · SA **licensing posture** + **partner contract/DPA** + FICA · publish SDK to npm · host
`developers.clairtus.com` · set `FLY_API_TOKEN`, `SENTRY_DSN`, `OTEL_*`, Supabase Auth envs · schedule
the `webhook-worker` + `reconcile`.
