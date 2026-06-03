import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The dashboard talks to the B2B API over HTTP via @clairtus/sdk (server-side).
  // Transpile the workspace SDK (it ships TypeScript source) so Vercel builds it cleanly.
  transpilePackages: ['@clairtus/sdk'],
};

export default nextConfig;
