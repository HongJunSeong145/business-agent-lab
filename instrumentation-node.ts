import { env } from "@/lib/env";
import { assertAiConfig } from "@/lib/ai/provider";

/** 환경변수·AI 설정 검증(지시서 3-4) — 잘못되면 시작 거부(프로세스 종료). 이후 내장 워커 시작. */
export async function onServerStart() {
  try {
    assertAiConfig(env());
  } catch (e) {
    console.error(`[KGB_Agent] 서버 시작 거부: ${(e as Error).message}`);
    process.exit(1);
  }
  // 워커를 웹 서버 안에서 실행 (개인용 배포 기본값, ADR-019)
  if (env().WORKER_MODE === "inline") {
    const { startWorker } = await import("@/lib/jobs/worker");
    void startWorker();
  }
}
