import type { NextConfig } from "next";

const API_BASE = (
  process.env.QUICKCART_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "http://localhost:8000"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  eslint: {
    // No ESLint config ships with this app; type checking via `tsc --noEmit` + `next build`.
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    // Same-origin proxy so the httpOnly qc_session cookie works without cross-site cookies:
    // /qc-api/v1/auth/me → ${API}/api/v1/auth/me
    return [{ source: "/qc-api/:path*", destination: `${API_BASE}/api/:path*` }];
  },
};

export default nextConfig;
