import type { Db } from "@/lib/db";
import { assertCan, type Actor } from "@/lib/auth/can";
import { writeAudit } from "@/lib/audit/log";
import { getPermissionSettings } from "@/lib/settings";
import { aiAvailable } from "@/lib/ai/runtime";
import { dispatchJob } from "@/lib/jobs/queue";
import { ServiceError } from "./invitations";

/** 추출 완료 후 자동 분석 작업 등록 (AI 사용 불가면 등록하지 않음 — T25) */
export async function enqueueAnalysisAfterExtract(db: Db, extractJobId: string, available = aiAvailable()) {
  if (!available) return null;
  const ex = await db.aiJob.findUnique({ where: { id: extractJobId } });
  const meetingId = (ex?.payload as { meetingId?: string } | null)?.meetingId;
  if (!meetingId) return null;
  const job = await db.aiJob.upsert({
    where: { idempotency_key: `analyze:${extractJobId}` },
    update: {},
    create: { type: "analyze_meeting", payload: { meetingId }, idempotency_key: `analyze:${extractJobId}` },
  });
  await dispatchJob(job.id, "analyze_meeting");
  return job.id;
}

/** 'AI 분석' / '재분석' 버튼 (8-3): 기존 대기 제안은 새 제안이 만들어질 때 대체된다 */
export async function requestAnalysis(db: Db, actor: Actor & { termId: string }, meetingId: string, available = aiAvailable()) {
  assertCan(actor, { type: "meeting.reanalyze" }, await getPermissionSettings(db, actor.termId));
  if (!available) throw new ServiceError("AI 일시 사용 불가 — 업무는 직접 만들 수 있습니다.", 503);
  const m = await db.meeting.findFirst({ where: { id: meetingId, term_id: actor.termId, deleted_at: null }, include: { files: { take: 1, orderBy: { created_at: "desc" } } } });
  if (!m) throw new ServiceError("회의록을 찾을 수 없습니다.", 404);
  if (!m.files[0]?.extracted_text) throw new ServiceError("추출된 원문이 없어 분석할 수 없습니다.");
  const running = await db.aiJob.count({ where: { type: { in: ["analyze_meeting", "propose_work"] }, status: { in: ["queued", "running"] }, payload: { path: ["meetingId"], equals: meetingId } } });
  if (running > 0) throw new ServiceError("이미 분석 중입니다.");
  const n = await db.aiJob.count({ where: { type: "analyze_meeting", payload: { path: ["meetingId"], equals: meetingId } } });
  const job = await db.$transaction(async (tx) => {
    const j = await tx.aiJob.create({ data: { type: "analyze_meeting", payload: { meetingId }, idempotency_key: `analyze:${meetingId}:manual:${n + 1}` } });
    await tx.meeting.update({ where: { id: meetingId }, data: { status: "analyzing" } });
    await writeAudit(tx, { actorId: actor.userId, action: "meeting.reanalyze", entityType: "meeting", entityId: meetingId });
    return j;
  });
  await dispatchJob(job.id, "analyze_meeting");
  return { aiJobId: job.id };
}

/** 회의록의 최근 분석 작업 상태 (화면 표시용) */
export async function latestAnalysisJob(db: Db, meetingId: string) {
  return db.aiJob.findFirst({
    where: { type: { in: ["analyze_meeting", "propose_work"] }, payload: { path: ["meetingId"], equals: meetingId } },
    orderBy: { created_at: "desc" },
  });
}
