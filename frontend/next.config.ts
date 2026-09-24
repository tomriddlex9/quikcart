import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // No ESLint config ships with this app; type checking via `tsc --noEmit` + `next build`.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
