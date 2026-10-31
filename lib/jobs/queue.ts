import { PgBoss } from "pg-boss";

/**
 * 작업 큐 (ADR-005): 실행·재시도는 pg-boss, 도메인 상태·멱등성은 ai_jobs 테이블.
 * pg-boss 는 자체 스키마(pgboss)를 쓰므로 Prisma(public 스키마)와 충돌하지 않는다.
 */
export const QUEUES = {
  extract: "meeting-extract",
  analyze: "meeting-analyze",
  propose: "meeting-propose",
  evaluate: "deliverable-evaluate",
  reference: "reference-make",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOB_TYPE_TO_QUEUE: Record<string, QueueName> = { extract: QUEUES.extract, analyze_meeting: QUEUES.analyze, propose_work: QUEUES.propose, evaluate_deliverable: QUEUES.evaluate, reference: QUEUES.reference };

const g = globalThis as unknown as { kgbBoss?: Promise<PgBoss> };

async function createBoss(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL 이 설정되지 않았습니다.");
  const boss = new PgBoss({ connectionString, max: 4, schema: "pgboss" });
  boss.on("error", (e) => console.error("[queue] pg-boss 오류:", e instanceof Error ? e.message : e));
  await boss.start();
  for (const name of Object.values(QUEUES)) {
    // 일시 오류만 재시도(최대 3회, 지수 백오프). 내용 문제(손상 파일 등)는 핸들러가 실패로 확정하고 재시도하지 않는다.
    await boss.createQueue(name, { retryLimit: 3, retryDelay: 5, retryBackoff: true, retryDelayMax: 120, expireInSeconds: 600 });
  }
  return boss;
}

export function getBoss(): Promise<PgBoss> {
  g.kgbBoss ??= createBoss().catch((e) => {
    g.kgbBoss = undefined;
    throw e;
  });
  return g.kgbBoss;
}

/**
 * ai_jobs 레코드를 큐에 보낸다. 실패해도 예외를 던지지 않는다 —
 * ai_jobs 가 queued 로 남아 있으므로 워커의 주기적 점검(sweeper)이 다시 보낸다.
 */
export async function dispatchJob(aiJobId: string, type: string): Promise<boolean> {
  if ((process.env.WORKER_MODE ?? "inline") === "off") return false;
  const queue = JOB_TYPE_TO_QUEUE[type];
  if (!queue) return false;
  try {
    const boss = await getBoss();
    await boss.send(queue, { aiJobId });
    return true;
  } catch (e) {
    console.error("[queue] 작업 전송 실패(점검 시 재전송):", e instanceof Error ? e.message : e);
    return false;
  }
}
