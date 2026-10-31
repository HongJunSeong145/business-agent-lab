import { z } from "zod";
import type { Db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { assertCan, type Actor } from "@/lib/auth/can";
import { writeAudit } from "@/lib/audit/log";
import { quarterOf } from "@kgb/rules";
import { dateColumnToString } from "@/lib/utils";
import { ServiceError } from "./invitations";
import { recomputeReadiness } from "./tasks";

export const PROJECT_CATEGORIES = ["event", "promotion", "partnership", "welfare", "admin", "other"] as const;
export const PROJECT_CATEGORY_LABEL: Record<(typeof PROJECT_CATEGORIES)[number], string> = {
  event: "행사", promotion: "홍보", partnership: "제휴", welfare: "복지", admin: "행정", other: "기타",
};
export const PROJECT_STATUSES = ["proposed", "planning", "approved", "in_progress", "done", "cancelled", "postponed"] as const;
export const PROJECT_STATUS_LABEL: Record<string, string> = {
  proposed: "제안", planning: "기획 중", approved: "승인됨", in_progress: "진행 중", done: "완료", cancelled: "취소", postponed: "연기",
};
export const FUNDING_LABEL: Record<string, string> = { school: "교비", student_fee: "학생회비" };

type ActorT = Actor & { termId: string };

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식이 올바르지 않습니다.");
const optDate = z.union([dateStr, z.literal(""), z.null()]).optional().transform((v) => v || null);
const money = z.coerce.number().int("금액은 원 단위 정수").min(0, "금액은 0 이상").max(1e12);

export const projectSchema = z
  .object({
    title: z.string().trim().min(1, "사업명을 입력하세요.").max(150),
    category: z.enum(PROJECT_CATEGORIES).default("event"),
    event_start: optDate,
    event_end: optDate,
    venue: z.string().trim().max(150).optional().transform((v) => v || null),
    expected_beneficiaries: z.union([z.coerce.number().int().min(0).max(100000), z.literal(""), z.null()]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
    host: z.string().trim().max(100).optional().transform((v) => v || null),
    organizer: z.string().trim().max(100).optional().transform((v) => v || null),
    uses_external_vendor: z.coerce.boolean().default(false),
    funding: z
      .array(z.object({ source: z.enum(["school", "student_fee"]), amount_planned: money }))
      .max(2)
      .default([])
      .refine((a) => new Set(a.map((f) => f.source)).size === a.length, "같은 재원을 두 번 넣을 수 없습니다."),
  })
  .refine((v) => !v.event_start || !v.event_end || v.event_start <= v.event_end, { message: "행사 종료일이 시작일보다 빠릅니다.", path: ["event_end"] });

export type ProjectInput = z.input<typeof projectSchema>;

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw new ServiceError(r.error.issues[0]?.message ?? "입력값 오류");
  return r.data;
}

async function computeQuarter(db: Db | Prisma.TransactionClient, termId: string, eventStart: string | null) {
  if (!eventStart) return null;
  const t = await db.term.findUniqueOrThrow({ where: { id: termId } });
  const s = (d: Date) => dateColumnToString(d);
  return quarterOf(
    { q1_start: s(t.q1_start), q1_end: s(t.q1_end), q2_start: s(t.q2_start), q2_end: s(t.q2_end), q3_start: s(t.q3_start), q3_end: s(t.q3_end), q4_start: s(t.q4_start), q4_end: s(t.q4_end) },
    eventStart,
  );
}

const toDate = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);

export async function createProject(db: Db, actor: ActorT, raw: unknown) {
  assertCan(actor, { type: "project.create" });
  const v = parse(projectSchema, raw);
  const quarter = await computeQuarter(db, actor.termId, v.event_start);
  return db.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: {
        term_id: actor.termId,
        title: v.title,
        category: v.category,
        status: "planning",
        event_start: toDate(v.event_start),
        event_end: toDate(v.event_end ?? v.event_start),
        venue: v.venue,
        expected_beneficiaries: v.expected_beneficiaries,
        host: v.host,
        organizer: v.organizer,
        uses_external_vendor: v.uses_external_vendor,
        quarter,
        funding_sources: { create: v.funding.map((f) => ({ source: f.source, amount_planned: BigInt(f.amount_planned) })) },
      },
    });
    await writeAudit(tx, { actorId: actor.userId, action: "project.create", entityType: "project", entityId: p.id, diff: { after: { ...v } } });
    return p;
  });
}

export async function updateProject(db: Db, actor: ActorT, id: string, raw: unknown) {
  assertCan(actor, { type: "project.confirmSchedule" });
  const v = parse(projectSchema, raw);
  const before = await db.project.findFirst({ where: { id, term_id: actor.termId, deleted_at: null }, include: { funding_sources: true } });
  if (!before) throw new ServiceError("사업을 찾을 수 없습니다.", 404);
  if (before.status === "cancelled") throw new ServiceError("취소된 사업은 수정할 수 없습니다.");
  const quarter = await computeQuarter(db, actor.termId, v.event_start);
  return db.$transaction(async (tx) => {
    const p = await tx.project.update({
      where: { id },
      data: {
        title: v.title, category: v.category, event_start: toDate(v.event_start), event_end: toDate(v.event_end ?? v.event_start),
        venue: v.venue, expected_beneficiaries: v.expected_beneficiaries, host: v.host, organizer: v.organizer,
        uses_external_vendor: v.uses_external_vendor, quarter,
      },
    });
    await tx.projectFundingSource.deleteMany({ where: { project_id: id, source: { notIn: v.funding.map((f) => f.source) } } });
    for (const f of v.funding) {
      await tx.projectFundingSource.upsert({
        where: { project_id_source: { project_id: id, source: f.source } },
        update: { amount_planned: BigInt(f.amount_planned) },
        create: { project_id: id, source: f.source, amount_planned: BigInt(f.amount_planned) },
      });
    }
    await writeAudit(tx, {
      actorId: actor.userId, action: "project.update", entityType: "project", entityId: id,
      diff: { before: { title: before.title, event_start: before.event_start, venue: before.venue, funding: before.funding_sources.map((f) => f.source) }, after: v },
    });
    return p;
  });
}

const statusSchema = z.object({ status: z.enum(["planning", "approved", "in_progress", "done", "postponed"]) });

/** 상태 변경(취소 제외). 연기 후 새 날짜는 updateProject 로 입력 → Phase 4 에서 일정 재계산 제안 */
export async function setProjectStatus(db: Db, actor: ActorT, id: string, raw: unknown) {
  assertCan(actor, { type: "project.confirmSchedule" });
  const { status } = parse(statusSchema, raw);
  const p = await db.project.findFirst({ where: { id, term_id: actor.termId, deleted_at: null } });
  if (!p) throw new ServiceError("사업을 찾을 수 없습니다.", 404);
  if (p.status === "cancelled") throw new ServiceError("취소된 사업의 상태는 바꿀 수 없습니다.");
  await db.$transaction(async (tx) => {
    await tx.project.update({ where: { id }, data: { status } });
    await writeAudit(tx, { actorId: actor.userId, action: "project.status", entityType: "project", entityId: id, diff: { before: p.status, after: status } });
  });
}

/**
 * 사업 취소 (4-3, T17): 미완료 업무 → cancelled, 완료 업무·수집된 증빙·일정은 보존(삭제 없음).
 * 캘린더에서는 사업 상태를 보고 취소선으로 표시한다.
 */
export async function cancelProject(db: Db, actor: ActorT, id: string) {
  assertCan(actor, { type: "project.cancel" });
  const p = await db.project.findFirst({ where: { id, term_id: actor.termId, deleted_at: null } });
  if (!p) throw new ServiceError("사업을 찾을 수 없습니다.", 404);
  if (p.status === "cancelled") throw new ServiceError("이미 취소된 사업입니다.");
  return db.$transaction(async (tx) => {
    const open = await tx.task.findMany({ where: { project_id: id, deleted_at: null, is_completed: false, status: { notIn: ["done", "cancelled"] } }, select: { id: true } });
    await tx.task.updateMany({ where: { id: { in: open.map((t) => t.id) } }, data: { status: "cancelled" } });
    await tx.project.update({ where: { id }, data: { status: "cancelled" } });
    await writeAudit(tx, { actorId: actor.userId, action: "project.cancel", entityType: "project", entityId: id, diff: { before: p.status, cancelled_tasks: open.length } });
    // 다른 사업 업무가 이 사업 업무에 의존하던 경우 차단 해제
    await recomputeReadiness(tx, actor.termId, { dependentsOf: open.map((t) => t.id) });
    return { cancelledTasks: open.length };
  });
}
