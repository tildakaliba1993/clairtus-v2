# B2B Escrow API container. Build context = repo ROOT (monorepo workspace deps).
#   fly deploy --config apps/b2b-api/fly.toml  (run from repo root)
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

# Full workspace is copied (so pnpm's frozen lockfile validates); --filter limits what installs.
# .dockerignore keeps node_modules/.next/.git out of the context.
COPY . .
RUN corepack pnpm install --frozen-lockfile --filter @clairtus/b2b-api...

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Run TypeScript directly via tsx — workspace packages export source; no separate build step.
CMD ["corepack", "pnpm", "--filter", "@clairtus/b2b-api", "start"]
