import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { dispatchJob, getBoss, QUEUES } from "./queue";
import { runExtractJob } from "./extract";
import { runAnalyzeJob, runProposeJob } from "@/lib/ai/agents";
import { runEvaluateJob } from "@/lib/ai/evaluate";
import { runReferenceJob } from "@/lib/ai/reference";
import { runPlanRebaseJob } from "@/lib/ai/plan-rebase";
import { runMonitor } from "@/lib/services/monitor";
import { getProvider } from "@/lib/ai/runtime";
import { enqueueAnalysisAfterExtract } from "@/lib/services/analysis";
import { todayKst } from "@/lib/clock";

const g = globalThis as unknown as { kgbWorker?: Promise<void>; kgbSweeper?: NodeJS.Timeout };

/** 멈춘 작업 복구: 오래 queued 인 작업 재전송, 오래 running 인 작업(프로세스 중단 등)은 queued 로 되돌림 */
export async function sweepStaleJobs(now = new Date()): Promise<number> {
  await prisma.aiJob.updateMany({
    where: { status: "running", started_at: { lt: new Date(now.getTime() - 10 * 60_000) } },
    data: { status: "queued" },
  });
  // 예산 대기 작업은 다음 날(KST) 다시 줄 세운다
  await prisma.aiJob.updateMany({
    where: { status: "waiting_budget", updated_at: { lt: new Date(`${todayKst()}T00:00:00+09:00`) } },
    data: { status: "queued", updated_at: new Date(0) },
  });
  const stale = await prisma.aiJob.findMany({
    where: { status: "queued", updated_at: { lt: new Date(now.getTime() - 60_000) } },
    take: 50,
  });
  for (const j of stale) {
    await prisma.aiJob.update({ where: { id: j.id }, data: { updated_at: now } });
    await dispatchJob(j.id, j.type);
  }
  return stale.length;
}

async function start() {
  const boss = await getBoss();
  const storage = getStorage();
  await boss.work<{ aiJobId: string }>(QUEUES.extract, { batchSize: 1, pollingIntervalSeconds: 1 }, async ([job]) => {
    if (!job) return;
    const outcome = await runExtractJob(prisma, storage, job.data.aiJobId);
    // 추출이 끝나면 AI 분석으로 이어진다(AI 를 쓸 수 없으면 회의록은 '추출 완료'로 남고 수동 기능은 그대로 — T25)
    if (outcome === "extracted") await enqueueAnalysisAfterExtract(prisma, job.data.aiJobId);
  });
  await boss.work<{ aiJobId: string }>(QUEUES.analyze, { batchSize: 1, pollingIntervalSeconds: 1 }, async ([job]) => {
    if (!job) return;
    const r = await runAnalyzeJob(prisma, getProvider(), job.data.aiJobId);
    if (r.nextJobId) await dispatchJob(r.nextJobId, "propose_work");
  });
  await boss.work<{ aiJobId: string }>(QUEUES.propose, { batchSize: 1, pollingIntervalSeconds: 1 }, async ([job]) => {
    if (job) await runProposeJob(prisma, getProvider(), job.data.aiJobId);
  });
  await boss.work<{ aiJobId: string }>(QUEUES.evaluate, { batchSize: 1, pollingIntervalSeconds: 1 }, async ([job]) => {
    if (job) await runEvaluateJob(prisma, storage, getProvider(), job.data.aiJobId);
  });
  await boss.work<{ aiJobId: string }>(QUEUES.reference, { batchSize: 1, pollingIntervalSeconds: 1 }, async ([job]) => {
    if (job) await runReferenceJob(prisma, getProvider(), job.data.aiJobId);
  });
  await boss.work<{ aiJobId: string }>(QUEUES.planRebase, { batchSize: 1, pollingIntervalSeconds: 1 }, async ([job]) => {
    if (job) await runPlanRebaseJob(prisma, getProvider(), job.data.aiJobId);
  });
  // A7: 매일 09:00 KST — 기수마다 점검(월요일은 주간 요약 포함)
  await boss.work(QUEUES.monitor, { batchSize: 1 }, async () => {
    const terms = await prisma.term.findMany({ where: { is_current: true }, select: { id: true } });
    for (const t of terms) await runMonitor(prisma, t.id, { provider: getProvider() });
  });
  if ((process.env.WORKER_MODE ?? "inline") !== "off" && process.env.APP_ENV !== "test") {
    await boss.schedule(QUEUES.monitor, "0 9 * * *", {}, { tz: "Asia/Seoul" });
  }
  g.kgbSweeper = setInterval(() => void sweepStaleJobs().catch((e) => console.error("[worker] 점검 오류:", e)), 60_000);
  g.kgbSweeper.unref();
  console.log("[worker] 작업 처리기 시작");
}

/** 워커 시작(프로세스당 1회). WORKER_MODE=inline 이면 웹 서버 안에서, separate 면 worker/index.ts 에서 호출 */
export function startWorker(): Promise<void> {
  g.kgbWorker ??= start().catch((e) => {
    g.kgbWorker = undefined;
    console.error("[worker] 시작 실패:", e instanceof Error ? e.message : e);
  });
  return g.kgbWorker;
}
