# Session Handoff — read this first

Continuity doc for a fresh session on **Clairtus B2B Escrow Infrastructure**. Paste the prompt in §1,
then read the docs in §3. _Written 2026-06-06, end of the M1–M11 + Phase-3 sprint._

---

## 1. ▶ Paste this prompt to resume

> Read `docs/SESSION_HANDOFF.md`, `docs/STATE_OF_BUILD.md`, and `docs/GAP_ANALYSIS_ULTIMATE.md` (in that
> order), then `git fetch && git log origin/main --oneline -15` and `gh pr list --state open`.
>
> Context: Clairtus B2B Escrow infra. The full lifecycle (sandbox + real-money code) is built, merged to
> `main`, and deployed live (API on Fly `clairtus-api.fly.dev`; dashboard on Vercel; DB on Supabase
> `clairtus-b2b`). ~205 tests green; monorepo typechecks. Work on `main` in `/Users/cash/clairtus-v2`;
> use `corepack pnpm …` (Node 22); the API runs under the **SWC runtime — never tsx**. One branch + PR
> per change; CI gates PRs. Use the keychain token for `gh` (see the `github-repo-and-gh-auth` memory).
>
> Do FIRST: confirm **PR #35** is merged (the singleton + session-driven self-serve fix — see §5). Then
> propose the plan: close the 🔴 money-correctness bugs (A2 payout reversal → A3 net-of-fees pay-in → A1
> idempotency race → A4 RLS) from `GAP_ANALYSIS_ULTIMATE.md` before any real money, OR continue Phase 3
> (returning-user session reconnect B8 → dashboard write actions → admin/dispute console → marketing →
> billing). Confirm you've read the docs and propose the breakdown before coding.

## 2. Environment & conventions (don't relearn the hard way)
- **`corepack pnpm`** (plain `pnpm` not on PATH). Node 22, pnpm 10.16.1. **No Docker** (pglite + jsdom + vitest).
- **API under SWC** (`@swc-node/register`) for DI + decorator metadata. **Never tsx** for anything using
  Nest DI / `@ApiProperty` (`start`, `webhook-worker`, `openapi:export`, `reconcile` already use SWC).
  `tsx` is fine only for plain scripts (`migrate`, `onboard`, `demo`).
- **Test/typecheck:** `corepack pnpm -r --filter "./packages/*" --filter "./apps/*" {test,typecheck}`.
- **TDD:** write the failing test first; one branch + PR per milestone; CI must be green.
- **Cross-cutting in NestJS lives in `app.module`** (APP_GUARD/APP_PIPE/APP_INTERCEPTOR), not `main.ts`,
  so it's active in the `Test.createTestingModule` e2e tests.
- **Env-gated integrations** follow one pattern (no-op until configured): Sentry (`SENTRY_DSN`), OTel
  (`OTEL_EXPORTER_OTLP_ENDPOINT`), self-serve auth (`SUPABASE_URL`). Mirror it for new ones.
- **git/gh:** `origin` URL is clean; commit as `tildakaliba1993 <tildakaliba1993@gmail.com>` (Vercel
  blocks previews if the commit email isn't on the GitHub account). `gh` keyring can't access the repo —
  feed it the keychain token: `GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential
  fill | sed -n 's/^password=//p') gh …`. The scoped PAT **can't read check-runs/statuses** (403) — check
  PR status in the UI. (See the `github-repo-and-gh-auth` auto-memory.)

## 3. Doc map (read order)
1. **This file** → 2. `STATE_OF_BUILD.md` (everything built) → 3. `GAP_ANALYSIS_ULTIMATE.md` (what's left,
the single source of truth). Then as needed: `PRD.md`/`PRD_FULL.md` (vision/requirements),
`DELIVERY_PLAN.md` + `IMPLEMENTATION_TASKS.md` (the phased plan), `ARCHITECTURE.md`, `DEPLOYMENT.md`
(env + ops), `QUICKSTART.md`/`DEVELOPER_DOCS.md` (integrate), `PROGRESS.md` (older E0–E5 history),
`PRODUCTION_READINESS.md` (per-section ✅ tracker). (`GAP_ANALYSIS_PHASE1_2.md` is superseded by the ultimate one.)

## 4. Where we are
- **All milestones M1–M11 + Phase-3 (P3.1 keys API, P3 keys UI, P3.2 self-serve signup, JWKS, runtime
  config) are MERGED to `main`** (PRs #18–#34). The full escrow lifecycle works end-to-end with
  hardening, compliance, KYC tiers, real pay-in + inbound webhook, router + durable queue/DLQ, audit log,
  reconciliation, Sentry/OTel hooks, typed SDK, key-management UI, and self-serve signup.
- **CI gates PRs; deploy-on-merge to Fly is wired** (needs repo secret `FLY_API_TOKEN`).

## 5. Open / in-flight
- **PR #35 — OPEN, MERGE IT.** `claude/dashboard-runtime-supabase` (commit `067b6a1`): singleton Supabase
  client + **session-driven auto-provision** (bridges to `/api/signup` on any session — instant signup,
  email-confirmation redirect, or login). This is the real fix for "Supabase user created but no Clairtus
  tenant." #34 merged only the earlier runtime-config commit.
- This handoff doc set is on branch `claude/session-handover` (its own PR).

## 6. Self-serve auth status (so you don't re-debug it)
- Supabase project `clairtus-b2b` (ref `uhgdewebkqqrlnxkuzaz`) uses **ECC P-256 (ES256)** signing keys.
  The API verifies them via **JWKS** when **`SUPABASE_URL`** is set (merged in #33). HS256 secret is a
  legacy fallback only.
- The dashboard reads Supabase config at **runtime** from `/api/auth-config` (set `SUPABASE_URL` +
  `SUPABASE_ANON_KEY` on Vercel, redeploy; `curl …/api/auth-config` → `{configured:true}` to verify).
- The `/signup` "not enabled yet" message = dashboard env not reaching the deployment. The "user created
  but no tenant" = email-confirmation-on + (pre-#35) provisioning only fired on an immediate session.
  After #35 + setting Supabase Auth (enable Email; turn off "Confirm email" OR set Site/Redirect URLs),
  signup auto-provisions a tenant + keys and connects.

## 7. Recommended next work (propose, then do)
**Before real money (small, focused — see `GAP_ANALYSIS_ULTIMATE.md` §A):** A2 payout reversal on
`transfer.failed` → A3 post actual net-of-fees pay-in → A1 idempotency claim-before-execute → A4 RLS as a
real backstop. Then B1 (versioned migrations), B3 (recon pending+fees), B2 (OTel instrumentations).

**Phase 3 continuation:** B8 returning-user session reconnect (API accepts the Supabase JWT for tenant
reads) → dashboard write actions → admin/dispute console → marketing site + custom domains → staging/DR/HA
→ billing.

**External (owner — track, don't block on):** Korapay live keys + static egress IP + custody sign-off;
legal (licensing/DPA/FICA); operator config + SDK publish + docs hosting (see `GAP_ANALYSIS_ULTIMATE.md` §D).

## 8. Task tracker note
The session task list tracked M1–M11 + P3.x (most completed). M10 (Korapay live, external) and the legal
track remain owner-gated. Recreate tasks from `GAP_ANALYSIS_ULTIMATE.md` §A/§B and §E as you pick up work.
