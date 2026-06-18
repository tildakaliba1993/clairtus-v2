import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to THIS project — the repo's parent pnpm-workspace.yaml otherwise makes
  // Next infer the monorepo root, which misplaces build output for standalone hosts (e.g. Netlify).
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
