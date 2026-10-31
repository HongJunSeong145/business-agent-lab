/** 서버 시작 시 1회 실행 — 환경변수·AI 설정 검증 (지시서 3-4). 설정이 잘못되면 시작을 거부(프로세스 종료)한다. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("@/lib/env");
  const { assertAiConfig } = await import("@/lib/ai/provider");
  try {
    assertAiConfig(env());
  } catch (e) {
    console.error(`[KGB_Agent] 서버 시작 거부: ${(e as Error).message}`);
    process.exit(1);
  }
}
