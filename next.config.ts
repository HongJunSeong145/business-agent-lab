import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // proxy 를 거치는 업로드 본문 버퍼 한도(기본 10MB) — 업로드 상한 50MB + multipart 여유
    proxyClientMaxBodySize: "55mb",
  },
  transpilePackages: ["@kgb/rules"],
  serverExternalPackages: ["@node-rs/argon2", "pg", "pg-boss", "unpdf", "mammoth"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
