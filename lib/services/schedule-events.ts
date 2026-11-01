import type { Db } from "@/lib/db";
import { assertCan, type Actor } from "@/lib/auth/can";
import { writeAudit } from "@/lib/audit/log";
import { ServiceError } from "./invitations";

type ActorT = Actor & { termId: string };

/**
 * 일정 항목(행정실 송부 마감 같은 규칙 마일스톤) 삭제·되살리기.
 * 규칙 엔진이 다시 계산해도 되살아나지 않도록 지우지 않고 '삭제됨(dismissed)'으로 둔다 —
 * 대시보드 30일 일정·캘린더·사업 일정에서 함께 빠지고, '최근 삭제'에서 되살릴 수 있다.
 */
export async function dismissScheduleEvent(db: Db, actor: ActorT, id: string) {
  assertCan(actor, { type: "project.confirmSchedule" });
  const e = await db.scheduleEvent.findFirst({ where: { id, term_id: actor.termId } });
  if (!e) throw new ServiceError("일정을 찾을 수 없습니다.", 404);
  if (e.state === "dismissed") return { ok: true };
  await db.$transaction(async (tx) => {
    await tx.scheduleEvent.update({ where: { id }, data: { state: "dismissed" } });
    await writeAudit(tx, { actorId: actor.userId, action: "schedule_event.delete", entityType: "project", entityId: e.project_id, diff: { eventId: id, title: e.title, before: e.state } });
  });
  return { ok: true };
}

export async function restoreScheduleEvent(db: Db, actor: ActorT, id: string) {
  assertCan(actor, { type: "project.confirmSchedule" });
  const e = await db.scheduleEvent.findFirst({ where: { id, term_id: actor.termId, state: "dismissed" } });
  if (!e) throw new ServiceError("되살릴 일정을 찾을 수 없습니다.", 404);
  const log = await db.activityLog.findFirst({ where: { action: "schedule_event.delete", entity_id: e.project_id }, orderBy: { created_at: "desc" } });
  const before = ((log?.diff as { before?: string } | null)?.before ?? "proposed") as string;
  await db.$transaction(async (tx) => {
    await tx.scheduleEvent.update({ where: { id }, data: { state: before === "dismissed" ? "proposed" : before } });
    await writeAudit(tx, { actorId: actor.userId, action: "schedule_event.restore", entityType: "project", entityId: e.project_id, diff: { eventId: id, title: e.title } });
  });
  return { ok: true };
}

/** 최근 삭제한 일정 — 되살리기 목록 */
export async function listDismissedEvents(db: Db, actor: ActorT, projectId?: string) {
  assertCan(actor, { type: "project.confirmSchedule" });
  return db.scheduleEvent.findMany({
    where: { term_id: actor.termId, state: "dismissed", ...(projectId ? { project_id: projectId } : {}), OR: [{ project_id: null }, { project: { deleted_at: null } }] },
    orderBy: { updated_at: "desc" },
    take: 30,
    select: { id: true, title: true, start: true, updated_at: true, project: { select: { id: true, title: true } } },
  });
}
