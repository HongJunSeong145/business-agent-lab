import { z } from "zod";
import type { Db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { assertCan, type Actor } from "@/lib/auth/can";
import { writeAudit } from "@/lib/audit/log";
import { quarterOf, quartersFromAcademicCalendar, type AcademicCalendar } from "@kgb/rules";
import { PARAM_SCHEMAS } from "@/lib/rule-params";
import { dateColumnToString } from "@/lib/utils";
import { ServiceError } from "./invitations";
import { recalcProjectSchedule } from "./schedule";

/** 설정 화면 서비스 (8-11): 기수·분기(D5)·배너 문구, 규칙 파라미터·휴일(5-7). 변경 이력은 감사 로그. */
type ActorT = Actor & { termId: string };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜를 입력하세요.");

export const termSchema = z
  .object({
    term_number: z.coerce.number().int().min(1, "제N대는 1 이상").max(999),
    name: z.string().trim().max(60).nullable().optional().transform((v) => v || null),
    council_name: z.string().trim().min(1, "학생회 이름을 입력하세요.").max(60),
    university: z.string().trim().max(60).default(""),
    college: z.string().trim().max(60).default(""),
    banner_title: z.string().trim().max(60).nullable().optional().transform((v) => v || null),
    banner_subtitle: z.string().trim().max(120).nullable().optional().transform((v) => v || null),
    q1_start: date, q1_end: date, q2_start: date, q2_end: date, q3_start: date, q3_end: date, q4_start: date, q4_end: date,
  })
  .superRefine((v, ctx) => {
    const seq = [v.q1_start, v.q1_end, v.q2_start, v.q2_end, v.q3_start, v.q3_end, v.q4_start, v.q4_end];
    for (let i = 1; i < seq.length; i++) {
      const ok = i % 2 === 1 ? seq[i - 1]! <= seq[i]! : seq[i - 1]! < seq[i]!;
      if (!ok) {
        ctx.addIssue({ code: "custom", message: "분기 날짜 순서가 올바르지 않습니다(각 분기 시작 ≤ 끝 < 다음 분기 시작)." });
        return;
      }
    }
  });

export const academicSchema = z.object({ electionEnd: date, sem1Start: date, sem1End: date, sem2Start: date, nextElectionEnd: date });

/** 학사일정 → 분기 날짜 미리 계산 (저장 전 화면에서 수정 가능) */
export function previewQuarters(raw: unknown) {
  const r = academicSchema.safeParse(raw);
  if (!r.success) throw new ServiceError(r.error.issues[0]?.message ?? "입력값 오류");
  try {
    return quartersFromAcademicCalendar(r.data as AcademicCalendar);
  } catch (e) {
    throw new ServiceError((e as Error).message);
  }
}

const d = (s: string) => new Date(`${s}T00:00:00Z`);

export async function updateTerm(db: Db, actor: ActorT, raw: unknown) {
  assertCan(actor, { type: "settings.manage" });
  const r = termSchema.safeParse(raw);
  if (!r.success) throw new ServiceError(r.error.issues[0]?.message ?? "입력값 오류");
  const v = r.data;
  const before = await db.term.findUniqueOrThrow({ where: { id: actor.termId }, include: { council: true } });
  return db.$transaction(async (tx) => {
    await tx.council.update({ where: { id: before.council_id }, data: { name: v.council_name, university: v.university, college: v.college } });
    const t = await tx.term.update({
      where: { id: actor.termId },
      data: {
        term_number: v.term_number, name: v.name, banner_title: v.banner_title, banner_subtitle: v.banner_subtitle,
        start_date: d(v.q1_start), end_date: d(v.q4_end),
        q1_start: d(v.q1_start), q1_end: d(v.q1_end), q2_start: d(v.q2_start), q2_end: d(v.q2_end),
        q3_start: d(v.q3_start), q3_end: d(v.q3_end), q4_start: d(v.q4_start), q4_end: d(v.q4_end),
      },
    });
    // 사업 분기 귀속 다시 계산 (5-5)
    const projects = await tx.project.findMany({ where: { term_id: actor.termId, event_start: { not: null } }, select: { id: true, event_start: true, quarter: true } });
    let moved = 0;
    for (const p of projects) {
      const q = quarterOf(v, dateColumnToString(p.event_start!));
      if (q !== p.quarter) {
        await tx.project.update({ where: { id: p.id }, data: { quarter: q } });
        moved++;
      }
    }
    await writeAudit(tx, {
      actorId: actor.userId, action: "settings.term", entityType: "term", entityId: actor.termId,
      diff: { before: { term_number: before.term_number, name: before.name, q1_start: before.q1_start, q4_end: before.q4_end }, after: v, projects_requartered: moved },
    });
    return t;
  });
}

export async function updateRuleSettings(db: Db, actor: ActorT, raw: unknown) {
  assertCan(actor, { type: "settings.manage" });
  if (!raw || typeof raw !== "object") throw new ServiceError("입력값 오류");
  const entries = Object.entries(raw as Record<string, unknown>).filter(([k]) => k in PARAM_SCHEMAS);
  if (entries.length === 0) throw new ServiceError("바꿀 설정이 없습니다.");
  const parsed: [string, unknown][] = [];
  for (const [k, v] of entries) {
    const r = PARAM_SCHEMAS[k as keyof typeof PARAM_SCHEMAS].safeParse(v);
    if (!r.success) throw new ServiceError(`${k}: ${r.error.issues[0]?.message ?? "형식 오류"}`);
    parsed.push([k, r.data]);
  }
  return db.$transaction(async (tx) => {
    const before = await tx.setting.findMany({ where: { term_id: actor.termId, key: { in: parsed.map(([k]) => k) } } });
    for (const [key, value] of parsed) {
      await tx.setting.upsert({
        where: { term_id_key: { term_id: actor.termId, key } },
        update: { value: value as Prisma.InputJsonValue },
        create: { term_id: actor.termId, key, value: value as Prisma.InputJsonValue },
      });
    }
    await writeAudit(tx, {
      actorId: actor.userId, action: "settings.rules", entityType: "settings", entityId: actor.termId,
      diff: { before: Object.fromEntries(before.map((b) => [b.key, b.value])), after: Object.fromEntries(parsed) },
    });
    // 파라미터가 바뀌면 진행 중 사업의 제안 마감 재계산
    const projects = await tx.project.findMany({ where: { term_id: actor.termId, deleted_at: null, status: { notIn: ["cancelled", "done"] }, event_start: { not: null } }, select: { id: true } });
    for (const p of projects) await recalcProjectSchedule(tx, actor.termId, p.id, "proposed");
    return { projectsRecalculated: projects.length };
  });
}
