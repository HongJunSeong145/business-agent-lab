import { todayKst } from "@/lib/clock";
import type { Db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { assertCan, type Actor } from "@/lib/auth/can";
import { writeAudit } from "@/lib/audit/log";
import { loadRuleParams } from "@/lib/rule-params";
import { dateColumnToString } from "@/lib/utils";
import {
  addDays, computeSchedule, deadlineConflicts, evidenceRequirements, templateFor, TEMPLATES,
  type FundingSource, type PromoTier, type RuleParams, type ScheduleInput, type ScheduleResult, type TemplateKey,
} from "@kgb/rules";
import { ServiceError } from "./invitations";
import { recomputeReadiness } from "./tasks";

/**
 * 규칙 엔진 연결 (PART 5, A3·A4 의 코드 부분): 표준 업무 생성, 마감 재계산, 행정실 송부 마일스톤, 증빙 요구사항.
 * LLM 은 사용하지 않는다(D16).
 */
type ActorT = Actor & { termId: string };
type Tx = Prisma.TransactionClient;
type DbLike = Db | Tx;

const toDate = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);

async function loadProjectForSchedule(db: DbLike, termId: string, projectId: string) {
  const p = await db.project.findFirst({
    where: { id: projectId, term_id: termId, deleted_at: null },
    include: {
      funding_sources: true,
      tasks: { where: { deleted_at: null, template_key: { not: null } }, select: { id: true, template_key: true, due_date: true, due_state: true, due_reason: true, is_completed: true, status: true } },
    },
  });
  if (!p) throw new ServiceError("사업을 찾을 수 없습니다.", 404);
  return p;
}
type ProjectForSchedule = Awaited<ReturnType<typeof loadProjectForSchedule>>;

export function scheduleInputFor(p: ProjectForSchedule, params: RuleParams, today: string, useFixed = true): ScheduleInput | null {
  if (!p.event_start) return null;
  const live = p.tasks.filter((t) => t.status !== "cancelled");
  const fixed: Partial<Record<TemplateKey, string>> = {};
  if (useFixed) for (const t of live) if ((t.due_state === "confirmed" || keepsOwnDue((t as { due_reason?: string | null }).due_reason)) && t.due_date) fixed[t.template_key as TemplateKey] = dateColumnToString(t.due_date);
  return {
    eventStart: dateColumnToString(p.event_start),
    eventEnd: p.event_end ? dateColumnToString(p.event_end) : null,
    today,
    funding: p.funding_sources.map((f) => f.source as FundingSource),
    usesVendor: p.uses_external_vendor,
    promoTier: (p.promo_tier as PromoTier | null) ?? null,
    params,
    fixed,
    done: live.filter((t) => t.is_completed).map((t) => t.template_key as TemplateKey),
  };
}

export type ProjectScheduleView = {
  hasEventDate: boolean;
  result: ScheduleResult | null;
  existingKeys: TemplateKey[];
  conflicts: { key: TemplateKey; title: string; confirmed: string; latest: string }[];
  evidence: ReturnType<typeof evidenceRequirements>;
};

/** 사업 일정 점검(미리보기) — 쓰기 없음 */
export async function getProjectSchedule(db: Db, actor: ActorT, projectId: string, today = todayKst()): Promise<ProjectScheduleView> {
  const p = await loadProjectForSchedule(db, actor.termId, projectId);
  const params = await loadRuleParams(db, actor.termId);
  const input = scheduleInputFor(p, params, today);
  const funding = p.funding_sources.map((f) => f.source as FundingSource);
  const evidence = evidenceRequirements(funding, p.expected_beneficiaries, params);
  const existingKeys = p.tasks.filter((t) => t.status !== "cancelled").map((t) => t.template_key as TemplateKey);
  if (!input) return { hasEventDate: false, result: null, existingKeys, conflicts: [], evidence };
  const confirmed = input.fixed ?? {};
  const conflicts = deadlineConflicts(confirmed, { ...input }).map((c) => ({ ...c, title: TEMPLATES[c.key].title }));
  return { hasEventDate: true, result: computeSchedule(input), existingKeys, conflicts, evidence };
}

async function syncMilestone(tx: Tx, termId: string, projectId: string, result: ScheduleResult) {
  const existing = await tx.scheduleEvent.findFirst({ where: { project_id: projectId, rule_key: "SCHOOL_SUBMIT" } });
  const m = result.milestones[0];
  if (!m) {
    if (existing) await tx.scheduleEvent.delete({ where: { id: existing.id } });
    return;
  }
  const title = m.feasible ? m.title : `${m.title} — 일정 불가`;
  if (existing) {
    await tx.scheduleEvent.update({ where: { id: existing.id }, data: { start: toDate(m.latest)!, title } });
  } else if (m.date) {
    // 이미 지난 날짜는 새로 만들지 않는다 (T6)
    await tx.scheduleEvent.create({
      data: { term_id: termId, project_id: projectId, title, start: toDate(m.date)!, all_day: true, kind: "milestone", state: "proposed", origin: "rule", rule_key: "SCHOOL_SUBMIT" },
    });
  }
}

async function syncEvidence(tx: Tx, p: ProjectForSchedule, params: RuleParams, result: ScheduleResult | null) {
  const funding = p.funding_sources.map((f) => f.source as FundingSource);
  const reqs = evidenceRequirements(funding, p.expected_beneficiaries, params);
  const end = p.event_end ? dateColumnToString(p.event_end) : p.event_start ? dateColumnToString(p.event_start) : null;
  const submit = result?.milestones[0]?.latest ?? null;
  const dueFor = (type: string) => {
    if (type === "official_letter" || type === "plan_doc") return submit;
    if (!end) return null;
    return type === "receipt" ? addDays(end, 7) : addDays(end, params.EVIDENCE_PHOTO_GRACE_DAYS);
  };
  const existing = await tx.evidenceRequirement.findMany({ where: { project_id: p.id }, include: { _count: { select: { items: true } } } });
  for (const r of reqs) {
    const cur = existing.find((e) => e.type === r.type);
    const data = { required: r.required, rule_source: r.rule_source, due_date: toDate(dueFor(r.type)) };
    if (cur) await tx.evidenceRequirement.update({ where: { id: cur.id }, data });
    else await tx.evidenceRequirement.create({ data: { project_id: p.id, type: r.type, ...data } });
  }
  // 더 이상 적용되지 않는 규칙 생성 요구는 제거(이미 제출된 증빙이 있으면 보존)
  for (const e of existing) {
    if (e.rule_source && !reqs.some((r) => r.type === e.type) && e._count.items === 0) await tx.evidenceRequirement.delete({ where: { id: e.id } });
  }
}

/** 회의록에 적힌 기한 또는 회의록 근거로 거꾸로 계산한 마감(사용자 결정 2026-10-31: 회의록 기준 마감 우선) */
export function keepsOwnDue(reason: string | null | undefined): boolean {
  return /^(회의록|역산)/.test(reason ?? "");
}

/**
 * 사업 일정 재계산 (5-3 ⑨, T16)
 *  - proposed: 제안 상태 마감만 새 계산값으로 바꾼다. 확정 마감은 유지(충돌은 화면 경고)
 *  - all: '일괄 재계산' — 확정 마감까지 규칙값으로 되돌리고 제안 상태로 표시
 */
export async function recalcProjectSchedule(tx: Tx, termId: string, projectId: string, mode: "proposed" | "all", today = todayKst()) {
  const p = await loadProjectForSchedule(tx, termId, projectId);
  const params = await loadRuleParams(tx as unknown as Db, termId);
  const input = scheduleInputFor(p, params, today, mode === "proposed");
  if (!input || p.status === "cancelled") {
    await syncEvidence(tx, p, params, null);
    return { updated: 0 };
  }
  const result = computeSchedule(input, false);
  let updated = 0;
  for (const t of p.tasks) {
    if (t.status === "cancelled" || t.is_completed) continue;
    const s = result.tasks.find((x) => x.key === t.template_key);
    if (!s) continue;
    // 회의록 기한·AI 역산(근거 있음) 마감은 자동 재계산으로 덮어쓰지 않는다 — '일괄 재계산'(all)만 규칙값으로 되돌린다
    if ((t.due_state === "confirmed" || keepsOwnDue(t.due_reason)) && mode === "proposed") {
      await tx.task.update({ where: { id: t.id }, data: { due_feasible: s.feasible } });
      continue;
    }
    const due = toDate(s.due);
    const changed = (t.due_date?.getTime() ?? null) !== (due?.getTime() ?? null) || t.due_state !== "proposed";
    await tx.task.update({ where: { id: t.id }, data: { due_date: due, due_state: "proposed", due_reason: s.reason, due_feasible: s.feasible } });
    if (changed) updated++;
  }
  await syncMilestone(tx, termId, projectId, result);
  await syncEvidence(tx, p, params, result);
  return { updated };
}

/** 표준 업무 생성 (5-2): 선택한 템플릿 업무를 제안 마감과 함께 만든다. 이미 있는 템플릿 업무는 건너뛴다. */
export async function applyStandardTemplate(db: Db, actor: ActorT, projectId: string, keys?: TemplateKey[], today = todayKst()) {
  assertCan(actor, { type: "task.create" });
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`task-deps:${actor.termId}`}))`;
    const p = await loadProjectForSchedule(tx, actor.termId, projectId);
    if (p.status === "cancelled") throw new ServiceError("취소된 사업입니다.");
    if (!p.event_start) throw new ServiceError("행사일을 먼저 입력하세요. 마감은 행사일에서 거꾸로 계산합니다.");
    const params = await loadRuleParams(tx as unknown as Db, actor.termId);
    const input = scheduleInputFor(p, params, today)!;
    const result = computeSchedule(input, false);
    const defs = templateFor({ funding: input.funding, usesVendor: input.usesVendor });
    const live = p.tasks.filter((t) => t.status !== "cancelled");
    const existing = new Map(live.map((t) => [t.template_key as TemplateKey, t.id]));
    const wanted = defs.filter((d) => !existing.has(d.key) && (!keys || keys.includes(d.key)));
    if (wanted.length === 0) throw new ServiceError("새로 만들 표준 업무가 없습니다.");

    const depts = Object.fromEntries((await tx.department.findMany({ where: { term_id: actor.termId } })).map((d) => [d.code, d.id]));
    const ids = new Map(existing);
    for (const d of wanted) {
      const s = result.tasks.find((x) => x.key === d.key)!;
      const t = await tx.task.create({
        data: {
          project_id: projectId,
          title: d.title,
          template_key: d.key,
          status: "todo",
          due_date: toDate(s.due),
          due_state: "proposed",
          due_reason: s.reason,
          due_feasible: s.feasible,
          acceptance_criteria: d.criteria.map((text) => ({ text, done: false })),
          departments: { create: [{ department_id: depts[d.lead]!, role: "lead" }, ...d.support.map((c) => ({ department_id: depts[c]!, role: "support" }))] },
        },
      });
      ids.set(d.key, t.id);
    }
    for (const d of wanted) {
      for (const dep of d.deps) {
        const pre = ids.get(dep.key);
        if (pre) await tx.taskDependency.create({ data: { task_id: ids.get(d.key)!, depends_on_task_id: pre, type: dep.type } });
      }
    }
    // 기존 템플릿 업무가 새로 만든 업무에 의존해야 하는 경우도 연결
    for (const d of defs.filter((x) => existing.has(x.key))) {
      for (const dep of d.deps) {
        if (wanted.some((w) => w.key === dep.key)) {
          await tx.taskDependency.create({ data: { task_id: existing.get(d.key)!, depends_on_task_id: ids.get(dep.key)!, type: dep.type } });
        }
      }
    }
    await syncMilestone(tx, actor.termId, projectId, result);
    await syncEvidence(tx, p, params, result);
    await writeAudit(tx, { actorId: actor.userId, action: "project.apply_template", entityType: "project", entityId: projectId, diff: { keys: wanted.map((w) => w.key) } });
    await recomputeReadiness(tx, actor.termId, { taskIds: [...ids.values()] });
    return { created: wanted.length, feasible: result.feasible };
  });
}

/** '일괄 재계산' 버튼 — 확정 마감까지 규칙값으로 되돌림(확인 후 실행) */
export async function recalcAll(db: Db, actor: ActorT, projectId: string, today = todayKst()) {
  assertCan(actor, { type: "project.confirmSchedule" });
  return db.$transaction(async (tx) => {
    const r = await recalcProjectSchedule(tx, actor.termId, projectId, "all", today);
    await writeAudit(tx, { actorId: actor.userId, action: "project.recalc_all", entityType: "project", entityId: projectId, diff: r });
    return r;
  });
}
