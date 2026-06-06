# Deployment Runbook

How Clairtus deploys. **The B2B API is a container (Fly.io) — not Vercel**; the Next.js apps are on
Vercel; the database is Supabase Postgres; the B2C product is WhatsApp on Supabase Edge.

## Hosting & domain map

| Surface | Domain | Host | Source |
|---|---|---|---|
| B2B marketing landing | `clairtus.com` | Vercel | `website` |
| Developer docs / API reference | `developers.clairtus.com` | Vercel (or the API's `/docs`) | docs site / Swagger |
| **B2B Escrow API** (+ `/docs`) | `api.clairtus.com` | **Fly.io (container)** | `apps/b2b-api` |
| Tenant **client dashboard** | `app.clairtus.com` | Vercel | `apps/client-dashboard` |
| Ops / dispute console | `admin.clairtus.com` | Vercel | `admin-panel` |
| B2C WhatsApp bot | WhatsApp (`wa.me`) | Supabase Edge | `supabase/functions` |
| Database | — | Supabase Postgres | shared |

## 0. Prerequisites
- Merge PRs to `main` in order: **#13 (E3) → #14 (E4) → #15 (E5) → this deploy-infra PR**. Vercel/Fly deploy from `main`.
- Accounts: **Fly.io**, **Vercel**, **Supabase**; DNS control for `clairtus.com`.
- Live credentials: Korapay (`sk_live_…`), Smile ID (partner id + api key).
- CLIs: `brew install flyctl` and `npm i -g vercel` (or use the Vercel dashboard).

## 1. Database — Supabase
1. Create a Supabase project (region close to ZA, e.g. `eu-west` / closest African region).
2. Copy the **Transaction pooler** connection string (pgBouncer, port `6543`) → this is `DATABASE_URL`.
   Our adapter defaults to `prepare:false` (required for the txn pooler). For a direct/session
   connection instead, set `PG_PREPARE=true`.
3. The API runs migrations automatically on each Fly release (`release_command`). To run manually:
   `DATABASE_URL=… corepack pnpm --filter @clairtus/b2b-api migrate`
   > **Role note:** the API connects as the **table owner** (it bypasses RLS and enforces tenant
   > isolation in the service layer). Use the same role/URL for migrations and the API.

## 2. API — Fly.io → `api.clairtus.com`
From the **repo root**:
```bash
fly auth login
fly launch --no-deploy --copy-config --config apps/b2b-api/fly.toml   # creates app "clairtus-api"

fly secrets set --config apps/b2b-api/fly.toml \
  DATABASE_URL="postgres://…6543/postgres" \
  KORAPAY_SECRET_KEY="sk_live_…" \
  KORAPAY_WEBHOOK_URL="https://api.clairtus.com/v1/webhooks/korapay" \
  SMILE_ID_PARTNER_ID="…" SMILE_ID_API_KEY="…" SMILE_ID_SANDBOX="false" \
  KYC_CALLBACK_URL="https://api.clairtus.com/v1/kyc/callback" \
  KYC_RELEASE_THRESHOLD="1000000"

fly deploy --config apps/b2b-api/fly.toml      # builds the image, runs migrate, then serves
fly certs add api.clairtus.com --config apps/b2b-api/fly.toml   # then add the shown DNS record
```
**⚠️ Static egress IP for Korapay (gate for live payouts).** Fly machines share regional egress IPs.
Korapay whitelists the IP that *calls* their payout API, so you need a **stable outbound IP**:
- Confirm the current egress IP: `fly ssh console -C "curl -s ifconfig.me" --config apps/b2b-api/fly.toml`
- Provision a dedicated/static egress (Fly dedicated IPv4 + egress, or front payouts via a static-IP
  proxy/NAT), then whitelist it in **Korapay → Settings → Security → IP Whitelisting (Live mode)**.
- Also confirm Korapay custody **(b)** no auto-sweep and **(d)** held-funds segregation in writing (from E2/T2.3).

Smoke: `curl https://api.clairtus.com/v1/health` → `{ "status": "ok" }` (static liveness);
`curl https://api.clairtus.com/v1/ready` → `{ "status": "ready" }` (readiness — pings the DB, `503`
when unreachable); open `https://api.clairtus.com/docs`.
> Fly's machine health check uses `/v1/health` (liveness) **on purpose** — a transient DB blip must not
> flap the machine. `/v1/ready` is for monitors/orchestrators that should route around a broken node.

## 3. Frontends — Vercel (monorepo: one project per app)
For each, create a Vercel project from this repo and set **Root Directory** (Vercel auto-detects Next +
pnpm workspaces; keep "Include source files outside the Root Directory" enabled):

| Vercel project | Root Directory | Domain | Env vars |
|---|---|---|---|
| clairtus-dashboard | `apps/client-dashboard` | `app.clairtus.com` | `CLAIRTUS_API_URL=https://api.clairtus.com/v1` |
| clairtus-web | `website` | `clairtus.com` | (B2B marketing) |
| clairtus-admin | `admin-panel` | `admin.clairtus.com` | existing `SUPABASE_*` / `ADMIN_*` |

- Install Command: `corepack pnpm install`  ·  Build Command: `pnpm build`  ·  Output: `.next` (auto).
- Add each custom domain in the Vercel project, then create the DNS records Vercel shows
  (CNAME → `cname.vercel-dns.com`, or A/ALIAS for the apex `clairtus.com`).

**Enable self-serve signup on the dashboard.** Set these on the `clairtus-dashboard` Vercel project
(plain env vars — read at **runtime**, no `NEXT_PUBLIC_` prefix needed), then **redeploy**:
- `SUPABASE_URL` = `https://<ref>.supabase.co`  ·  `SUPABASE_ANON_KEY` = the anon/public key
- `CLAIRTUS_API_URL` already points at the API.
Verify it's live: `curl https://<dashboard>/api/auth-config` → `{ "configured": true }`. If it says
`false`, the env isn't reaching the deployment (set it on **Production** scope + redeploy). Use the
**same** Supabase project as the API's `SUPABASE_URL`. In **Supabase → Authentication**:
- **Sign In / Providers → Email** enabled. For **instant** signup, turn **off** "Confirm email"
  (signup returns a session immediately → auto-provision + connect).
- If you keep "Confirm email" **on**: **URL Configuration → Site URL** = the dashboard URL, and add it
  (plus `…/signup`) to **Redirect URLs**, so the confirmation link returns to the dashboard — where the
  session is detected and the tenant is auto-provisioned. (The dashboard bridges on *any* session:
  instant signup, the confirmation redirect, or login.)
- **Rate Limits**: the default signup limit is low (the "you can only request this after N seconds"
  message) — raise it for demos/testing.

## 4. B2C WhatsApp — Supabase Edge (unchanged)
Already live in DRC. Deploy as before: `supabase functions deploy whatsapp-webhook` (and `smile-id-callback`).
The consumer "app" is WhatsApp itself — `app.clairtus.com` is the **dashboard**; a B2C deep-link
(`wa.me/<number>`) can live on the marketing site.

## 5. Post-deploy
- **Background worker:** `corepack pnpm --filter @clairtus/b2b-api webhook-worker` drains **due webhook
  deliveries** (retry/backoff) **and** the **payout-dispatch queue** (rails that were down at request
  time), then exits. Two ways to run it:
  - **Scheduled machine / cron** (~every 1 min): `fly machine run … --schedule` (one pass per run), or
  - **Always-on machine** with `webhook-worker --loop` (`WORKER_INTERVAL_MS`, default 60000) — a second
    Fly process/machine sharing the image + `DATABASE_URL`.
  Runs under the SWC runtime (Nest DI), same as the API.
- **Reconciliation:** schedule `corepack pnpm --filter @clairtus/b2b-api reconcile` (e.g. hourly). It
  compares ledger custody vs the Korapay balance per currency and **exits non-zero on drift** — wrap it
  in a cron/alert. `RECON_TOLERANCE_MINOR` sets the allowed drift.
- **Onboard the first design partner:** see `docs/ONBOARDING.md` (sandbox `ck_test_…` first).
- **Observability:** logs are structured JSON stamped with `X-Request-Id`; set `OTEL_EXPORTER_OTLP_ENDPOINT`
  to ship traces to a collector; scrape **`GET /v1/system/metrics`** (queue depth, DLQ, webhook backlog)
  for dashboards/alerts; `SENTRY_DSN` for error tracking.

## 6. CI/CD — GitHub Actions

Two workflows in `.github/workflows/`:

- **`ci.yml`** — on every **PR into `main`**: `pnpm install --frozen-lockfile` → typecheck → test
  across all `packages/*` + `apps/*`. Tests are Docker-free (pglite + jsdom), so no services are needed.
- **`deploy.yml`** — on every **push to `main`**: re-runs typecheck + test, then (only if they pass)
  runs `flyctl deploy --ha=false --remote-only` for the API. The dashboard auto-deploys via Vercel on
  push, so it isn't handled here.

**One-time setup:** add a repo secret **`FLY_API_TOKEN`** (`fly tokens create deploy -a clairtus-api`)
in GitHub → Settings → Secrets and variables → Actions. Until it's set, the deploy step **skips**
gracefully (CI still goes green), so merging is never blocked by a missing secret.

## API environment variables

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Supabase Postgres (txn pooler) — without it, money endpoints 500 |
| `PORT` | (3000) | Listen port (Fly sets via fly.toml) |
| `PG_POOL_MAX` / `PG_PREPARE` | — | Pool size / prepared-statement toggle |
| `KORAPAY_SECRET_KEY` | for live payouts | Enables the live Korapay rail (else live payouts no-op to ledger) |
| `KORAPAY_WEBHOOK_URL` | — | Where Korapay posts collection/transfer events |
| `SMILE_ID_PARTNER_ID` / `SMILE_ID_API_KEY` | for KYC | Enables the Smile ID provider |
| `SMILE_ID_SANDBOX` | — | `false` for production Smile ID |
| `KYC_CALLBACK_URL` | for KYC | Public URL Smile ID calls back |
| `KYC_RELEASE_THRESHOLD` | — | Global fallback release amount (minor units) requiring a VERIFIED seller |
| `THROTTLE_LIMIT` / `THROTTLE_TTL` | — | Per-API-key rate limit (default 300 req / 60000 ms) |
| `SENTRY_DSN` | — | Enables Sentry error tracking (5xx reported with correlation id); no-op when unset |
| `WORKER_INTERVAL_MS` | — | `webhook-worker --loop` poll interval (default 60000) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | Enables OpenTelemetry tracing to that collector; no-op when unset |
| `RECON_TOLERANCE_MINOR` | — | Allowed ledger↔PSP drift (minor units) before `reconcile` flags it |
| `SUPABASE_JWT_SECRET` | for self-serve | Verifies Supabase session JWTs on `/v1/auth/*`; unset = self-serve off |

**Dashboard self-serve env** (Vercel, `apps/client-dashboard`): set `NEXT_PUBLIC_SUPABASE_URL` +
`NEXT_PUBLIC_SUPABASE_ANON_KEY` to enable the `/signup` page. Use the **same** Supabase project whose JWT
secret is set as `SUPABASE_JWT_SECRET` on the API, so the API can verify the dashboard's session tokens.
| `FICA_DAILY_MAX_USD` / `FICA_MONTHLY_MAX_USD` | — | SA compliance caps (USD); defaults 1500 / 15000 |
| `FX_ZAR_USD` / `FX_NGN_USD` / `FX_CDF_USD` | — | Local major units per 1 USD for compliance conversion |
| `KYC_THRESHOLD_ZA_USD` / `KYC_THRESHOLD_CD_USD` | — | Per-market KYC step-up tier (USD); overrides the global fallback |
| `STRUCTURING_THRESHOLD` | — | Repeated same-counterparty escrows in 24h that flag structuring (default 3) |

## What is NOT auto-deployable yet (carry-forwards)
- Versioned, incremental migrations (today `migrate` applies the idempotent full schema — fine for v1).
- A compiled (non-tsx) API image for smaller/faster cold starts (tsx runtime is fine for MVP scale).
- OpenTelemetry exporter; richer OpenAPI DTO schemas.
