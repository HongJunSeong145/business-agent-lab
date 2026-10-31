/** 서버 시작 시 1회 실행 — 환경변수·AI 설정 검증 (지시서 3-4) */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("@/lib/env");
  const { assertAiConfig } = await import("@/lib/ai/provider");
  const e = env();
  assertAiConfig(e);
}
