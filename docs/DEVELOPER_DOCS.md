# Developer Docs & SDK Distribution

How partners discover and integrate Clairtus: the **hosted docs** (`developers.clairtus.com`), the
**interactive OpenAPI** (`/docs`), and the **published SDK** (`@clairtus/sdk`). Pairs with
[`QUICKSTART.md`](QUICKSTART.md).

## 1. Interactive API reference (live now)

The API serves Swagger UI at **`/docs`** and the raw spec at **`/docs-json`**
(e.g. `https://clairtus-api.fly.dev/docs`). Request/response schemas are derived from the decorated
DTOs (`@ApiProperty`), grouped by `@ApiTags`, with the bearer **api-key** security scheme.

Export the spec to a file (no server / DB needed) for a static docs site or CI artifact:

```bash
corepack pnpm --filter @clairtus/b2b-api openapi:export openapi.json
```

## 2. Hosting developers.clairtus.com

Two low-cost options (pick one):

- **Redoc / Swagger UI static site on Vercel** — a tiny project that loads `openapi.json` (produced by
  `openapi:export`, regenerated in CI on merge). Map the `developers.clairtus.com` domain in Vercel.
- **Point the subdomain at the API's `/docs`** — fastest; less branded. Add a Fly/edge route or a
  redirect from `developers.clairtus.com` → `https://api.clairtus.com/docs`.

DNS + Vercel project creation are operator steps (see `DEPLOYMENT.md §9` for the domain map).
Recommended: the Redoc static site, with the QUICKSTART rendered alongside the reference.

## 3. Publishing the SDK (`@clairtus/sdk`)

The package is publish-ready: dev/workspace consumers resolve `./src` (TypeScript), while the
**published** artifact ships compiled `dist` (ESM + `.d.ts`) via `publishConfig`.

```bash
# from repo root
corepack pnpm --filter @clairtus/sdk build        # emits packages/sdk/dist (+ d.ts)
cd packages/sdk
npm publish --access public                        # prepublishOnly re-runs the build
```

**Prerequisites (operator):** an npm account with access to the `@clairtus` org/scope, and `npm login`
(or an `NPM_TOKEN` in CI). Bump `version` + update `CHANGELOG.md` per release (SemVer).

> Until the first publish, partners can install from a tarball: `pnpm --filter @clairtus/sdk build`
> then `cd packages/sdk && npm pack` → share the resulting `.tgz`.

## 4. What partners get

- `npm install @clairtus/sdk` → typed `ClairtusClient` (escrows, parties, payouts, KYC, balances,
  ledger, webhooks) + `verifyWebhookSignature`.
- Auto-idempotency on money POSTs; cursor pagination on list calls; typed error envelope.
- The QUICKSTART flow runs end-to-end against sandbox with a `ck_test_…` key.
