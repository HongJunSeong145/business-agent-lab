import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // 다른 사이트가 이 앱을 iframe 으로 감싸지 못하게, 플러그인·base 태그 바꿔치기·외부로 폼 전송 금지 (10-3)
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
  // HTTPS 로만 접속(브라우저는 http 응답의 이 헤더를 무시하므로 로컬 개발에는 영향 없음)
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
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
    // 파일 응답(/api/files)은 같은 사이트의 PDF·동영상 미리보기 iframe 에서만 열 수 있게 SAMEORIGIN
    const fileHeaders = securityHeaders
      .filter((h) => h.key !== "X-Frame-Options" && h.key !== "Content-Security-Policy")
      .concat([{ key: "X-Frame-Options", value: "SAMEORIGIN" }]);
    return [
      { source: "/((?!api/files).*)", headers: securityHeaders },
      { source: "/api/files", headers: fileHeaders },
    ];
  },
};

export default nextConfig;
