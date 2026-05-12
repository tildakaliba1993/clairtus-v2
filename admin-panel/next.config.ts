import type { NextConfig } from "next";
import path from "node:path";

/** npm workspaces hoist `next` at repo root; Turbopack needs that root when cwd is `admin-panel`. */
function repoRootForTurbopack(): string {
  const cwd = process.cwd();
  return path.basename(cwd) === "admin-panel"
    ? path.resolve(cwd, "..")
    : cwd;
}

const nextConfig: NextConfig = {
  reactCompiler: true,
  devIndicators: false,
  turbopack: {
    root: repoRootForTurbopack(),
  },
};

export default nextConfig;
