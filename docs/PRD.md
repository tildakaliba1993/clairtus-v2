# Clairtus — Product Requirements Document (PRD)

**Status:** Draft v1 (for scrutiny & approval)
**Owner:** CTO (Product & Engineering)
**Last updated:** 2026-06
**Related docs:** `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`

---

## 1. Vision & Mission

**Mission:** Become the **horizontal trust layer for African commerce** — the escrow and trusted-payments infrastructure that any marketplace, classifieds site, or gig platform plugs into so their users can transact without fear of fraud.

**One-liner:** *MangoPay for Africa, wedged on escrow.*

We start as a consumer escrow product (B2C, live in the DRC over WhatsApp) to prove the engine, and scale into a **B2B Escrow Infrastructure API** that other platforms build on.

---

## 2. Problem

African digital commerce has a **trust deficit**:

- Peer-to-peer marketplaces are scam-ridden. In South Africa, ~40% of classifieds users fear fraud, and SABRIC reports rising P2P digital crime on platforms like Gumtree and Facebook Marketplace.
- The informal economy is cash-based and leaves **no paper trail** (e.g., a tenant paying a $1,000 deposit gets a handwritten note at best).
- Payment rails are **fragmented** across mobile money, bank, and card, and vary by country — building trusted, compliant payment flows is hard for every marketplace to do alone.
- Existing escrow solutions (e.g., Gumtree's Shepherd, Yaga) are **closed, single-platform, single-bank, single-country**. There is no **horizontal, embeddable, multi-rail, multi-country** trust layer.

**Opportunity:** Own that horizontal layer.

---

## 3. Strategy & Market Sequencing

| Phase | Product | Market | Purpose |
|---|---|---|---|
| **Now** | B2C WhatsApp escrow (live) | DR Congo | Prove the escrow engine + generate live proof/data for the B2B raise |
| **MVP (this doc)** | B2B Escrow Infrastructure API | **South Africa (beachhead)** | Onboard first design partners; pre-seed raise |
| **Next** | Same API | **Nigeria** (primary B2B market; co-founder network) | Scale; requires NG entity (CAC) |
| **Later** | Same API | Kenya, Ghana, … | Expand the trust layer continent-wide |

**Why this order:** the DRC product is built and cheap to keep live (proof). South Africa is our legal base (Fincrest Pty Ltd) and a clean beachhead to onboard design partners *now* (self-serve rails like Korapay, no $200k minimums). Nigeria is the big B2B prize (densest marketplace ecosystem, co-founder ties) once a NG entity is registered.

---

## 4. Moats (what we deliberately build toward)

1. **🏆 Cross-platform trust/reputation graph** *(headline, most investable)* — escrow + fraud + dispute outcomes aggregated across **every** platform we power → a **portable transaction-trust score** that follows buyers/sellers across marketplaces. A credit-bureau-for-commerce. Single-platform incumbents (Shepherd, Yaga) structurally cannot build this; we can, because we are horizontal. Compounding network effect.
2. **Regulatory / fund-holding moat** — multi-market fund-holding via licensed-partner orchestration now, our own EME/PSP licences later. High barrier.
3. **Compliance-as-infrastructure per market** — local rules (BCC, FICA, CBN…) encoded once and reused. Hard to replicate across countries.
4. **Multi-rail × multi-country coverage via one API** — breadth single-bank/single-country players can't match.
5. **Embeddedness / switching costs** — once a platform's checkout + payout + dispute flow runs on us, removal is painful.

**Build-toward priority:** the reputation graph is a *data by-product* of doing escrow well across many tenants. We instrument for it from day one (every escrow outcome is a signed, retained event keyed to party identity), even though the graph product ships post-MVP.

---

## 5. Target Customers (Design Partners) & Their Needs

> Correction from initial assumption: **Gumtree already has escrow** (Shepherd, Standard Bank-powered) and Yaga has its own. We do **not** target incumbents that already solved this. We target platforms that *can't or haven't* built it.

| Tier | Examples | Core use case | Specific needs |
|---|---|---|---|
| **🥇 Gig / services marketplaces** | Kandua, SweepSouth, HirePro, Terawork | Hold client payment until job done | **Milestone/partial releases**, fast worker payouts, platform-commission split, dispute handling |
| **🥈 Long-tail classifieds** | 50+ fragmented SA platforms with no escrow | P2P goods sales | Simple escrow on a listing, buyer pay-in, release on receipt, trust badge |
| **🥉 High-ticket verticals** | Private car sales, property/rental deposits, agri/equipment | Large single transactions | KYC on parties, clear hold + receipt, refund/dispute |
| **🆕 New / emerging marketplaces** | Anyone launching now | Trust infra out of the box | Drop-in API + sandbox + docs, white-label |

**Lead-target decision (CTO call, given no warm intros):** run a two-pronged outreach, because with no warm intros, landing a design partner is a **funnel/numbers game** (target ~10–15 to land 1–2):
- **Prong A — Gig/services marketplaces (easiest "yes" + recurring volume):** Kandua, SweepSouth, HirePro, Terawork. They already crave milestone-escrow + fast payouts and are actively adding embedded financial services, so the pitch lands fast.
- **Prong B — High-ticket P2P verticals (most acute pain + highest willingness to pay):** private/used **vehicle** sales, equipment/agri, rental/property deposits. A single fraud is catastrophic (R100k+), so escrow is obviously worth it and these segments are largely escrow-less.

The first signed design partner from *either* prong sets the initial integration spec. Both are de-risked because the API is the same; only the use-case config differs.

**Universal design-partner needs → MVP feature set:**
- Create an **escrow** tied to their order/listing, via API.
- **Buyer pay-in**: card, instant EFT/**PayShap**, EFT (SA); mobile money (DRC/other).
- **Hold** funds with a licensed partner (we never take custody).
- **Conditional release** on the platform's trigger (delivery/job confirmation), incl. **partial/milestone**.
- **Split**: platform commission + seller net (+ secondary beneficiaries).
- **Payout** to seller bank/wallet.
- **Refund / dispute** lifecycle.
- **Webhooks** to drive their UI ("funds secured", "released", "payout failed").
- **KYC** on parties for higher-ticket.
- **White-label**, **sandbox**, **docs**, **SDK**, minimal **dashboard**.

---

## 6. Products

### 6.1 B2C WhatsApp Escrow (existing — maintain, don't scale)
- Live in DRC, mobile money via PawaPay, under BCC limits.
- Becomes **"reference client #1"** of the shared escrow core — proof + data, not a growth focus.
- No new consumer features beyond keeping it live and migrating it onto the shared core.

### 6.2 B2B Escrow Infrastructure API (this MVP — the focus)
A multi-tenant, rail-agnostic API that lets a platform embed escrow:
- Tenant onboarding + API keys (test/live).
- Escrow lifecycle API + webhooks + ledger-backed balances.
- Pluggable payment rails (Korapay for SA, PawaPay for DRC mobile money).
- KYC, compliance/limits, dispute resolution.
- Sandbox, docs, TypeScript SDK, minimal client dashboard.

---

## 7. Functional Requirements (B2B API)

**FR-1 Tenancy & Auth** — Tenants (client platforms) onboard, get test + live API keys; all data isolated per tenant.
**FR-2 Parties** — Represent buyers, sellers, secondary beneficiaries; reusable across escrows; carry KYC status + (future) trust score.
**FR-3 Escrow lifecycle** — Create → Fund (pay-in) → Hold → Release (full/partial/split) → Settle (payout) → Complete; plus Refund, Cancel, Dispute. Each transition is an event.
**FR-4 Pay-in** — Initiate a collection via the routed rail; return payment instructions / hosted link / virtual account; confirm via webhook; idempotent.
**FR-5 Hold (ledger)** — Funds held in a tenant/escrow ledger account; never auto-settled to the tenant until release.
**FR-6 Release & Split** — On the tenant's trigger, release funds: full or partial (milestones), split between platform commission + seller(s) + secondary beneficiaries.
**FR-7 Payout** — Disburse net amounts to recipients via the routed rail; handle failure/retry; webhook on result.
**FR-8 Refund / Dispute** — Refund (full/partial) to buyer; structured dispute states with admin/arbitration resolution.
**FR-9 KYC** — Trigger identity verification (Smile ID) on a party; tiered by limits; status drives release eligibility for higher-ticket.
**FR-10 Fees** — Per-tenant configurable platform fee + Clairtus fee; transparent breakdown on every escrow.
**FR-11 Webhooks** — Signed, retried event delivery; documented event catalog; per-tenant endpoint config.
**FR-12 Idempotency** — Idempotency keys required on all money-moving operations.
**FR-13 Ledger / balances** — Tenants can query balances, transactions, and statements; double-entry, auditable.
**FR-14 Dashboard** — Minimal client dashboard: API keys, escrows, balances, payouts, webhook logs, sandbox toggle.
**FR-15 Sandbox** — Full sandbox with simulated rails and test credentials, parity with production.

---

## 8. API Resource Model (high level)

`Tenant`, `ApiKey`, `Party`, `Escrow`, `PayIn`, `Payout`, `LedgerAccount`, `LedgerEntry`, `WebhookEndpoint`, `Event`, `KycCheck`, `Dispute`.

(Detailed schema & endpoints in `ARCHITECTURE.md`.)

---

## 9. Non-Functional Requirements

- **Scalability:** stateless services, horizontal scale; ledger designed for correctness under concurrency; per-tenant partitioning path.
- **Reliability:** idempotency everywhere; durable queue + DLQ; rail circuit breakers; signed retried webhooks.
- **Security:** API-key auth, secret hashing, Postgres RLS tenant isolation, encryption in transit/at rest, least-privilege; minimal PCI scope (no raw card data in MVP — hosted collection only).
- **Observability:** structured logging, request tracing, metrics, alerting from day one.
- **Compliance:** see §10. Auditable, immutable event log; record retention (≥5–10 years per market).
- **Availability target (MVP):** 99.5%, with a path to 99.9%.

---

## 10. Compliance & Regulatory

- **Custody:** we do **not** hold client funds directly in the MVP. Funds are held by the **licensed partner PSP** (Korapay / PawaPay); we orchestrate release. This keeps us out of needing our own EME/PSP licence to launch.
- **Per-market rule engine:** limits & KYC thresholds encoded per country (DRC = BCC: 500 USD/day, 2,500 USD/month, live FX; SA = FICA-aligned; etc.).
- **AML/KYC:** customer identification (Smile ID), transaction monitoring (velocity/structuring detection — reused from B2C), sanctions/PEP screening (fast-follow), suspicious-activity flagging, record retention.
- **No structuring:** the platform must never facilitate splitting a transaction to evade limits.
- **Licensing roadmap:** own EME/PSP licences per market is a **post-seed** moat milestone, not an MVP blocker.

---

## 11. Success Metrics

**MVP / design-partner readiness:**
- ≥ 2–3 SA design partners integrated in sandbox; ≥ 1 processing live escrows.
- End-to-end escrow (create → pay-in → hold → release/split → payout → webhook) working on Korapay (SA) and PawaPay (DRC).
- Sandbox + docs + SDK published; a partner can integrate without hand-holding.

**Investability (pre-seed):**
- Live B2C proof (DRC) + signed design-partner LOIs + working API demo.
- Instrumented reputation-graph data accruing (escrow outcomes per party).

---

## 12. MVP Scope (Balanced, ~10–12 weeks)

**In scope:**
- Shared escrow `core` extracted from the B2C state machine (B2C kept live on it).
- Double-entry **Postgres ledger** + holds.
- **Multi-tenancy** + API keys + RLS isolation + per-tenant config.
- Payment-rail abstraction with **2 adapters: Korapay (SA) + PawaPay (DRC)** + router.
- B2B REST API: escrows, parties, pay-in, release/split, payouts, refund, balances.
- **Idempotency**, **signed webhooks**, event catalog.
- **KYC** via Smile ID (tiered).
- **Sandbox** + **docs** + **TypeScript SDK** + minimal **client dashboard**.
- Per-market **compliance/limit engine** (DRC BCC + SA basics).

**Out of scope (post-MVP / fast-follow):**
- Reputation-graph *product* (instrument data now, build product later).
- Card rails (hosted Cards Checkout) — add when a partner needs it.
- Fincra & additional rails; multi-currency FX beyond what's needed.
- Full sanctions-screening automation; SOC2/PCI certification; advanced reconciliation/reporting.
- Self-serve tenant signup (manual onboarding of design partners is fine for MVP).

---

## 13. Risks & Assumptions

- **Custody/hold model (clarified):** we do **not** need a native "escrow/conditional-release" product from any PSP. Escrow = collected funds rest in **our PSP balance/wallet** (Korapay default = balance; Fincra = wallet) + our ledger attributes them per-escrow + we trigger payout-from-balance on the release condition. Research confirms both Korapay and Fincra support collect-to-balance + payout-from-balance. The one config requirement: **keep settlement in the PSP balance (no auto-settle-to-bank)** so custody stays with the licensed PSP. *Validate balance-hold duration & segregation with Korapay early (gating spike T2.3).*
- **Nigeria go-live needs a CAC entity** — register in parallel; SA is the live beachhead meanwhile.
- **Solo technical build** (AI-assisted) — scope discipline is essential; the ledger and multi-tenancy are the riskiest builds (mitigated by TDD).
- **Regulatory:** custody-via-partner keeps us compliant for MVP; own licensing is a later moat.
- This PRD is a living document — to be scrutinized, refined, and approved before build.
