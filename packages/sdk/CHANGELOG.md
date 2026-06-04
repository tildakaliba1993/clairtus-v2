# Changelog

All notable changes to `@clairtus/sdk` are documented here. Follows [SemVer](https://semver.org/).

## 0.1.0 — 2026-06-04

First publishable release.

### Added
- Typed client `ClairtusClient`: parties, escrows, payouts, KYC, balances, ledger, webhook endpoints/deliveries.
- `verifyWebhookSignature` for inbound webhook verification.
- **Auto-idempotency** on money-moving POSTs (`fund`/`release`/`refund`/`payouts.create`) — a per-call
  `Idempotency-Key` is generated when not supplied.
- **Cursor pagination** on `escrows.list`, `payouts.list`, and `ledger` via `{ limit, cursor }` → `{ data, nextCursor }`.
- Build pipeline (`dist` ESM + `.d.ts`) and npm publish config (`publishConfig`).
