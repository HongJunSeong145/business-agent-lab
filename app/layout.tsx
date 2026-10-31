import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const pretendard = localFont({
  src: "../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  display: "swap",
  weight: "45 920",
  variable: "--font-pretendard",
});

export const metadata: Metadata = {
  title: "KGB_Agent",
  description: "회의록 중심 학생회 업무 지원 플랫폼",
  robots: { index: false, follow: false },
};

function StagingBanner() {
  if (process.env.APP_ENV !== "staging") return null;
  return (
    <div role="note" className="bg-[#FDE68A] px-4 py-1.5 text-center text-xs font-medium text-[#5C3D00]">
      테스트 환경 — 실제 데이터 입력 금지
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={pretendard.variable}>
      <body className="min-h-screen antialiased" style={{ fontFamily: "var(--font-pretendard), var(--font-sans)" }}>
        <StagingBanner />
        {children}
      </body>
    </html>
  );
}
