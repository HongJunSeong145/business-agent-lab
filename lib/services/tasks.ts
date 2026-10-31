import { z } from "zod";
import type { Db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { assertCan, can, isLeader, type Actor, type TaskResource } from "@/lib/auth/can";
import { writeAudit } from "@/lib/audit/log";
import { effectiveProgress, nextAutoStatus, taskReadiness, wouldCreateCycle, type DependencyType } from "@kgb/rules";
import { ServiceError } from "./invitations";
import { recalcProjectSchedule } from "./schedule";

/**
 * 업무 서비스 (PART 4 업무, D3·D7·D10, 4-3).
 * - 업무 레코드는 하나, 주관 1 + 협조 N 국서 연결로 여러 국서 화면에 동시 표시(복제 없음)
 * - 진척도 3값 분리 저장: ai_progress / manual_progress / is_completed, 표시는 effective 공식
 * - 모든 쓰기는 트랜잭션 + 감사 로그, 진척도 변화는 progress_history 에도 기록
 */
type ActorT = Actor & { termId: string };
type Tx = Prisma.TransactionClient;

export const TASK_STATUS_LABEL: Record<string, string> = {
  blocked: "차단", todo: "할 일", in_progress: "진행 중", review: "검토", done: "완료", cancelled: "취소",
};
export const DEPENDENCY_LABEL: Record<DependencyType, string> = {
  finish_to_start: "완료 후 착수", approval_required: "결재 후 착수", draft_ok: "초안 있으면 착수",
};

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw new ServiceError(r.error.issues[0]?.message ?? "입력값 오류");
  return r.data;
}

const uuid = z.string().uuid();
const criteriaSchema = z.array(z.object({ text: z.string().trim().min(1).max(200), done: z.boolean().default(false) })).max(30);

const taskFields = {
  title: z.string().trim().min(1, "업무명을 입력하세요.").max(150),
  description: z.string().trim().max(5000).nullable().optional(),
  project_id: uuid.nullable().optional(),
  lead_department_id: uuid,
  support_department_ids: z.array(uuid).max(5).default([]),
  assignee_ids: z.array(uuid).max(20).default([]),
  due_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "마감일 형식 오류"), z.literal(""), z.null()]).optional().transform((v) => v || null),
  weight: z.coerce.number().positive("가중치는 0보다 커야 합니다.").max(100).default(1),
  acceptance_criteria: criteriaSchema.default([]),
  allow_draft_start: z.boolean().default(false),
};

export const createTaskSchema = z.object({
  ...taskFields,
  dependencies: z.array(z.object({ depends_on_task_id: uuid, type: z.enum(["finish_to_start", "approval_required", "draft_ok"]) })).max(20).default([]),
});

export const updateTaskSchema = z
  .object({
    title: taskFields.title,
    description: taskFields.description,
    lead_department_id: taskFields.lead_department_id,
    support_department_ids: z.array(uuid).max(5),
    assignee_ids: z.array(uuid).max(20),
    due_date: taskFields.due_date,
    due_state: z.enum(["proposed", "confirmed"]),
    weight: z.coerce.number().positive("가중치는 0보다 커야 합니다.").max(100),
    acceptance_criteria: criteriaSchema,
    allow_draft_start: z.boolean(),
    status: z.enum(["todo", "in_progress", "review", "cancelled"]),
  })
  .partial();

const termTaskWhere = (termId: string): Prisma.TaskWhereInput => ({
  deleted_at: null,
  departments: { some: { role: "lead", department: { term_id: termId } } },
});

export async function loadTask(db: Db | Tx, termId: string, id: string) {
  const t = await db.task.findFirst({
    where: { id, ...termTaskWhere(termId) },
    include: { departments: true, assignees: true, project: true },
  });
  if (!t) throw new ServiceError("업무를 찾을 수 없습니다.", 404);
  return t;
}

export function taskResource(t: { departments: { department_id: string }[]; assignees: { user_id: string }[] }): TaskResource {
  return { assigneeIds: t.assignees.map((a) => a.user_id), departmentIds: t.departments.map((d) => d.department_id) };
}

async function validateRefs(tx: Tx, termId: string, v: { project_id?: string | null; lead_department_id?: string; support_department_ids?: string[]; assignee_ids?: string[] }) {
  if (v.project_id) {
    const p = await tx.project.findFirst({ where: { id: v.project_id, term_id: termId, deleted_at: null } });
    if (!p) throw new ServiceError("사업을 찾을 수 없습니다.");
    if (p.status === "cancelled") throw new ServiceError("취소된 사업에는 업무를 추가할 수 없습니다.");
  }
  const deptIds = [v.lead_department_id, ...(v.support_department_ids ?? [])].filter(Boolean) as string[];
  if (deptIds.length) {
    const n = await tx.department.count({ where: { id: { in: deptIds }, term_id: termId } });
    if (n !== new Set(deptIds).size) throw new ServiceError("국서를 찾을 수 없습니다.");
  }
  if (v.lead_department_id && v.support_department_ids?.includes(v.lead_department_id)) {
    throw new ServiceError("주관 국서를 협조 국서로 함께 지정할 수 없습니다.");
  }
  if (v.assignee_ids?.length) {
    const n = await tx.membership.count({ where: { term_id: termId, user_id: { in: v.assignee_ids } } });
    if (n !== new Set(v.assignee_ids).size) throw new ServiceError("담당자는 이 기수의 회원이어야 합니다.");
  }
}

async function lockDependencies(tx: Tx, termId: string) {
  // 같은 기수의 의존관계 변경을 직렬화(동시 추가로 인한 순환 방지)
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`task-deps:${termId}`}))`;
}

async function assertNoCycle(tx: Tx, termId: string, taskId: string, dependsOn: string) {
  const edges = await tx.taskDependency.findMany({
    where: { task: termTaskWhere(termId) },
    select: { task_id: true, depends_on_task_id: true },
  });
  if (wouldCreateCycle(edges.map((e) => [e.task_id, e.depends_on_task_id] as const), taskId, dependsOn)) {
    throw new ServiceError("의존관계가 순환합니다(서로가 서로를 기다리게 됨). 선후 관계를 다시 확인하세요.");
  }
}

/**
 * blocked/todo 자동 계산 (D7). 대상: 지정한 업무 + (지정한 업무에 의존하는 후속 업무).
 * 사용자가 진행 중 이후로 옮긴 업무는 바꾸지 않는다.
 */
export async function recomputeReadiness(tx: Tx, termId: string, scope: { taskIds?: string[]; dependentsOf?: string[] }) {
  const ids = new Set(scope.taskIds ?? []);
  if (scope.dependentsOf?.length) {
    const deps = await tx.taskDependency.findMany({ where: { depends_on_task_id: { in: scope.dependentsOf } }, select: { task_id: true } });
    deps.forEach((d) => ids.add(d.task_id));
  }
  if (ids.size === 0) return;
  const tasks = await tx.task.findMany({
    where: { id: { in: [...ids] }, ...termTaskWhere(termId) },
    include: { dependencies: { include: { depends_on: true } } },
  });
  for (const t of tasks) {
    const r = taskReadiness(
      t.dependencies
        .filter((d) => d.depends_on.deleted_at === null)
        .map((d) => ({
          type: d.type as DependencyType,
          predecessor: { title: d.depends_on.title, status: d.depends_on.status, is_completed: d.depends_on.is_completed, effective_progress: effectiveProgress(d.depends_on) },
        })),
      t.allow_draft_start,
    );
    const status = nextAutoStatus(t.status, r);
    const startedOnDraft = status === "todo" ? r.startedOnDraft : t.started_on_draft_plan;
    if (status !== t.status || startedOnDraft !== t.started_on_draft_plan) {
      await tx.task.update({ where: { id: t.id }, data: { status, started_on_draft_plan: startedOnDraft || t.started_on_draft_plan } });
      if (status !== t.status) {
        await writeAudit(tx, { actorId: null, actorKind: "system", action: "task.auto_status", entityType: "task", entityId: t.id, diff: { before: t.status, after: status, reasons: r.reasons } });
      }
    }
  }
}

export type ParsedTask = z.output<typeof createTaskSchema>;
export type TaskExtra = {
  template_key?: string | null;
  due_state?: "proposed" | "confirmed";
  due_reason?: string | null;
  due_feasible?: boolean;
  source_proposal_id?: string | null;
};

export function parseTask(raw: unknown): ParsedTask {
  return parse(createTaskSchema, raw);
}

/** 트랜잭션 안에서 업무 생성 — 직접 생성과 AI 제안 승인이 함께 쓴다 */
export async function insertTaskTx(tx: Tx, actor: ActorT, v: ParsedTask, extra: TaskExtra = {}) {
  await validateRefs(tx, actor.termId, v);
  const task = await tx.task.create({
    data: {
      project_id: v.project_id ?? null,
      title: v.title,
      description: v.description ?? null,
      status: "todo",
      due_date: v.due_date ? new Date(`${v.due_date}T00:00:00Z`) : null,
      // D1: 국장 이상이 직접 입력한 마감은 즉시 확정
      due_state: extra.due_state ?? "confirmed",
      due_reason: extra.due_reason !== undefined ? extra.due_reason : v.due_date ? "직접 입력" : null,
      due_feasible: extra.due_feasible ?? true,
      template_key: extra.template_key ?? null,
      source_proposal_id: extra.source_proposal_id ?? null,
      weight: v.weight,
      acceptance_criteria: v.acceptance_criteria,
      allow_draft_start: v.allow_draft_start,
      departments: {
        create: [
          { department_id: v.lead_department_id, role: "lead" },
          ...v.support_department_ids.map((d) => ({ department_id: d, role: "support" })),
        ],
      },
      assignees: { create: [...new Set(v.assignee_ids)].map((u) => ({ user_id: u })) },
    },
  });
  if (v.dependencies.length) {
    await lockDependencies(tx, actor.termId);
    for (const d of v.dependencies) {
      await loadTask(tx, actor.termId, d.depends_on_task_id);
      await assertNoCycle(tx, actor.termId, task.id, d.depends_on_task_id);
      await tx.taskDependency.create({ data: { task_id: task.id, depends_on_task_id: d.depends_on_task_id, type: d.type } });
    }
  }
  await writeAudit(tx, { actorId: actor.userId, action: "task.create", entityType: "task", entityId: task.id, diff: { after: v, ...extra } });
  await recomputeReadiness(tx, actor.termId, { taskIds: [task.id] });
  return task;
}

export async function createTask(db: Db, actor: ActorT, raw: unknown) {
  assertCan(actor, { type: "task.create" });
  const v = parse(createTaskSchema, raw);
  return db.$transaction(async (tx) => {
    const task = await insertTaskTx(tx, actor, v);
    return tx.task.findUniqueOrThrow({ where: { id: task.id } });
  });
}

/** 같은 사업의 표준 업무끼리 빠진 의존관계를 템플릿대로 잇는다 (제안 승인으로 업무가 나뉘어 생길 때) */
export async function linkTemplateDependencies(tx: Tx, termId: string, projectId: string) {
  const { TEMPLATES } = await import("@kgb/rules");
  const rows = await tx.task.findMany({ where: { project_id: projectId, deleted_at: null, template_key: { not: null }, status: { not: "cancelled" } }, select: { id: true, template_key: true } });
  const byKey = new Map(rows.map((r) => [r.template_key!, r.id]));
  const existing = await tx.taskDependency.findMany({ where: { task_id: { in: rows.map((r) => r.id) } }, select: { task_id: true, depends_on_task_id: true } });
  const has = new Set(existing.map((e) => `${e.task_id}>${e.depends_on_task_id}`));
  const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { uses_external_vendor: true } });
  let added = 0;
  for (const r of rows) {
    const def = TEMPLATES[r.template_key as keyof typeof TEMPLATES];
    if (!def) continue;
    const deps = [...def.deps, ...(def.key === "FIN_PURCHASE" && project.uses_external_vendor ? [{ key: "VENDOR_CONFIRM" as const, type: "finish_to_start" as const }] : [])];
    for (const d of deps) {
      const pre = byKey.get(d.key);
      if (!pre || has.has(`${r.id}>${pre}`)) continue;
      await tx.taskDependency.create({ data: { task_id: r.id, depends_on_task_id: pre, type: d.type } });
      has.add(`${r.id}>${pre}`);
      added++;
    }
  }
  if (added) await recomputeReadiness(tx, termId, { taskIds: rows.map((r) => r.id) });
  return added;
}

export async function updateTask(db: Db, actor: ActorT, id: string, raw: unknown) {
  const v = parse(updateTaskSchema, raw);
  const t = await loadTask(db, actor.termId, id);
  const res = taskResource(t);
  const onlyStatus = Object.keys(v).every((k) => k === "status");
  const memberStatusChange = onlyStatus && v.status !== "cancelled" && can(actor, { type: "task.adjustProgress", task: res });
  if (!memberStatusChange) {
    // 업무 내용·배정·마감 변경은 국장 이상 (Q5: 국원은 마감 변경 '요청'만 — Phase 5 검토 화면과 함께 제공)
    assertCan(actor, { type: "task.assign" });
  }
  if (t.status === "cancelled" && v.status !== "todo") throw new ServiceError("취소된 업무입니다. 먼저 '할 일'로 되돌리세요.");
  if (v.status && t.status === "blocked" && (v.status === "in_progress" || v.status === "review")) {
    throw new ServiceError("선행 업무를 기다리는 중(차단)이라 시작할 수 없습니다.");
  }
  if (v.status && t.is_completed && v.status !== "cancelled") throw new ServiceError("완료된 업무입니다. 완료를 해제한 뒤 상태를 바꾸세요.");

  const lead = v.lead_department_id ?? t.departments.find((d) => d.role === "lead")!.department_id;
  const support = v.support_department_ids ?? t.departments.filter((d) => d.role === "support").map((d) => d.department_id);

  return db.$transaction(async (tx) => {
    await validateRefs(tx, actor.termId, { lead_department_id: lead, support_department_ids: support, assignee_ids: v.assignee_ids });
    const data: Prisma.TaskUpdateInput = {};
    if (v.title !== undefined) data.title = v.title;
    if (v.description !== undefined) data.description = v.description;
    if (v.weight !== undefined) data.weight = v.weight;
    if (v.acceptance_criteria !== undefined) data.acceptance_criteria = v.acceptance_criteria;
    if (v.allow_draft_start !== undefined) data.allow_draft_start = v.allow_draft_start;
    if (v.status !== undefined) data.status = v.status;
    if (v.due_date !== undefined) {
      data.due_date = v.due_date ? new Date(`${v.due_date}T00:00:00Z`) : null;
      // 사용자가 마감을 고치면 확정(D2, 5-3 ⑨)
      data.due_state = "confirmed";
      data.due_reason = v.due_date ? "사용자 지정" : null;
    } else if (v.due_state !== undefined) {
      data.due_state = v.due_state;
    }
    await tx.task.update({ where: { id }, data });

    if (v.lead_department_id !== undefined || v.support_department_ids !== undefined) {
      await tx.taskDepartment.deleteMany({ where: { task_id: id } });
      await tx.taskDepartment.createMany({
        data: [{ task_id: id, department_id: lead, role: "lead" }, ...support.map((d) => ({ task_id: id, department_id: d, role: "support" }))],
      });
    }
    if (v.assignee_ids !== undefined) {
      await tx.taskAssignee.deleteMany({ where: { task_id: id } });
      await tx.taskAssignee.createMany({ data: [...new Set(v.assignee_ids)].map((u) => ({ task_id: id, user_id: u })) });
    }
    const before = { title: t.title, status: t.status, due_date: t.due_date, due_state: t.due_state, weight: Number(t.weight), departments: t.departments.map((d) => `${d.role}:${d.department_id}`), assignees: res.assigneeIds };
    await writeAudit(tx, { actorId: actor.userId, action: "task.update", entityType: "task", entityId: id, diff: { before, after: v } });
    if (v.allow_draft_start !== undefined || v.status !== undefined) await recomputeReadiness(tx, actor.termId, { taskIds: [id], dependentsOf: [id] });
    // 마감 확정·변경 → 같은 사업의 제안 마감·실현 가능 여부 재계산 (5-3 ⑨)
    if (t.project_id && (v.due_date !== undefined || v.due_state !== undefined || v.status !== undefined)) {
      await recalcProjectSchedule(tx, actor.termId, t.project_id, "proposed");
    }
    return tx.task.findUniqueOrThrow({ where: { id } });
  });
}

/** 상태가 '할 일'인데 진척이 생기면 '진행 중'으로 */
function statusAfterProgress(status: string, effective: number): string {
  return status === "todo" && effective > 0 ? "in_progress" : status;
}

// null 을 먼저 검사해야 한다(z.coerce.number 가 null 을 0 으로 바꾸므로)
const manualSchema = z.object({ value: z.union([z.null(), z.coerce.number().int().min(0, "0~100").max(100, "0~100")]) });

/** 수동 진척도 조정 (D3). value=null 이면 'AI 평가로 되돌리기' */
export async function setManualProgress(db: Db, actor: ActorT, id: string, raw: unknown) {
  const { value } = parse(manualSchema, raw);
  const t = await loadTask(db, actor.termId, id);
  assertCan(actor, { type: "task.adjustProgress", task: taskResource(t) });
  if (t.status === "cancelled") throw new ServiceError("취소된 업무입니다.");
  return db.$transaction(async (tx) => {
    const next = { ...t, manual_progress: value };
    await tx.task.update({ where: { id }, data: { manual_progress: value, status: statusAfterProgress(t.status, effectiveProgress(next)) } });
    await tx.progressHistory.create({
      data: { task_id: id, field: "manual", old_value: t.manual_progress?.toString() ?? null, new_value: value?.toString() ?? null, actor: "user", actor_user_id: actor.userId, reason: value === null ? "AI 평가로 되돌리기" : null },
    });
    await writeAudit(tx, { actorId: actor.userId, action: "task.progress_manual", entityType: "task", entityId: id, diff: { before: t.manual_progress, after: value } });
    await recomputeReadiness(tx, actor.termId, { dependentsOf: [id] });
    return tx.task.findUniqueOrThrow({ where: { id } });
  });
}

/**
 * AI 진척도 기록 (6-1 예외: ai_progress 만 갱신, manual·완료 값은 건드리지 않음).
 * Phase 6 의 A6 평가가 호출한다. 지금은 테스트에서 값 주입용(T14·T15).
 */
export async function setAiProgress(db: Db, termId: string, id: string, value: number, evaluationId: string | null = null) {
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new ServiceError("AI 진척도는 0~100 정수");
  const t = await loadTask(db, termId, id);
  return db.$transaction(async (tx) => {
    const next = { ...t, ai_progress: value };
    await tx.task.update({ where: { id }, data: { ai_progress: value, status: statusAfterProgress(t.status, effectiveProgress(next)) } });
    await tx.progressHistory.create({ data: { task_id: id, field: "ai", old_value: t.ai_progress?.toString() ?? null, new_value: String(value), actor: "ai", evaluation_id: evaluationId } });
    await writeAudit(tx, { actorId: null, actorKind: "ai", action: "task.progress_ai", entityType: "task", entityId: id, diff: { before: t.ai_progress, after: value } });
    await recomputeReadiness(tx, termId, { dependentsOf: [id] });
  });
}

/**
 * 완료 체크 / 해제 (D3, T15).
 *  - 완료: effective 100, AI 마지막 평가는 이력에 "AI 평가 72% / 사용자 완료 확정"으로 병기
 *  - 해제: manual·ai 값이 남아 있으므로 직전 값으로 복귀. 상태는 선행 조건에 따라 차단/할 일/진행 중
 *  - 후속 업무의 차단 상태를 다시 계산
 */
export async function setCompleted(db: Db, actor: ActorT, id: string, completed: boolean) {
  const t = await loadTask(db, actor.termId, id);
  assertCan(actor, { type: "task.complete", task: taskResource(t) });
  if (t.status === "cancelled") throw new ServiceError("취소된 업무입니다.");
  if (t.is_completed === completed) return t;
  if (completed && t.status === "blocked") throw new ServiceError("선행 업무를 기다리는 중(차단)이라 완료할 수 없습니다.");
  return db.$transaction(async (tx) => {
    const now = new Date();
    if (completed) {
      await tx.task.update({ where: { id }, data: { is_completed: true, completed_by: actor.userId, completed_at: now, status: "done" } });
    } else {
      const effectiveAfter = effectiveProgress({ ...t, is_completed: false });
      await tx.task.update({ where: { id }, data: { is_completed: false, completed_by: null, completed_at: null, status: effectiveAfter > 0 ? "in_progress" : "todo" } });
    }
    const aiNote = t.ai_progress !== null ? `AI 평가 ${t.ai_progress}% / ` : "";
    await tx.progressHistory.create({
      data: {
        task_id: id, field: "completed", old_value: String(t.is_completed), new_value: String(completed), actor: "user", actor_user_id: actor.userId,
        reason: completed ? `${aiNote}사용자 완료 확정` : "완료 해제",
      },
    });
    await writeAudit(tx, { actorId: actor.userId, action: completed ? "task.complete" : "task.uncomplete", entityType: "task", entityId: id });
    await recomputeReadiness(tx, actor.termId, { taskIds: completed ? [] : [id], dependentsOf: [id] });
    if (t.project_id && t.template_key) await recalcProjectSchedule(tx, actor.termId, t.project_id, "proposed");
    return tx.task.findUniqueOrThrow({ where: { id } });
  });
}

const depSchema = z.object({ depends_on_task_id: uuid, type: z.enum(["finish_to_start", "approval_required", "draft_ok"]) });

export async function addDependency(db: Db, actor: ActorT, taskId: string, raw: unknown) {
  assertCan(actor, { type: "task.assign" });
  const v = parse(depSchema, raw);
  return db.$transaction(async (tx) => {
    await lockDependencies(tx, actor.termId);
    await loadTask(tx, actor.termId, taskId);
    await loadTask(tx, actor.termId, v.depends_on_task_id);
    const exists = await tx.taskDependency.findUnique({ where: { task_id_depends_on_task_id: { task_id: taskId, depends_on_task_id: v.depends_on_task_id } } });
    if (exists) throw new ServiceError("이미 연결된 선행 업무입니다.");
    await assertNoCycle(tx, actor.termId, taskId, v.depends_on_task_id);
    const dep = await tx.taskDependency.create({ data: { task_id: taskId, depends_on_task_id: v.depends_on_task_id, type: v.type } });
    await writeAudit(tx, { actorId: actor.userId, action: "task.dependency_add", entityType: "task", entityId: taskId, diff: v });
    await recomputeReadiness(tx, actor.termId, { taskIds: [taskId] });
    return dep;
  });
}

export async function removeDependency(db: Db, actor: ActorT, taskId: string, dependencyId: string) {
  assertCan(actor, { type: "task.assign" });
  return db.$transaction(async (tx) => {
    await loadTask(tx, actor.termId, taskId);
    const r = await tx.taskDependency.deleteMany({ where: { id: dependencyId, task_id: taskId } });
    if (r.count === 0) throw new ServiceError("의존관계를 찾을 수 없습니다.", 404);
    await writeAudit(tx, { actorId: actor.userId, action: "task.dependency_remove", entityType: "task", entityId: taskId, diff: { dependencyId } });
    await recomputeReadiness(tx, actor.termId, { taskIds: [taskId] });
  });
}

/** 업무 삭제(소프트 삭제 4-1) — 후속 업무의 차단 해제 */
export async function deleteTask(db: Db, actor: ActorT, id: string) {
  assertCan(actor, { type: "task.create" });
  await loadTask(db, actor.termId, id);
  await db.$transaction(async (tx) => {
    const dependents = await tx.taskDependency.findMany({ where: { depends_on_task_id: id }, select: { task_id: true } });
    await tx.task.update({ where: { id }, data: { deleted_at: new Date() } });
    await tx.taskDependency.deleteMany({ where: { OR: [{ task_id: id }, { depends_on_task_id: id }] } });
    await writeAudit(tx, { actorId: actor.userId, action: "task.delete", entityType: "task", entityId: id });
    await recomputeReadiness(tx, actor.termId, { taskIds: dependents.map((d) => d.task_id) });
  });
}

/** 업무 드로어용 상세 (개요·이력) + 현재 사용자 권한 */
export async function getTaskDetail(db: Db, actor: ActorT, id: string) {
  const t = await db.task.findFirst({
    where: { id, ...termTaskWhere(actor.termId) },
    include: {
      project: { select: { id: true, title: true, status: true } },
      departments: { include: { department: true } },
      assignees: { include: { user: { select: { id: true, display_name: true } } } },
      dependencies: { include: { depends_on: { select: { id: true, title: true, status: true, is_completed: true, ai_progress: true, manual_progress: true, deleted_at: true } } } },
      dependents: { include: { task: { select: { id: true, title: true, status: true, deleted_at: true } } } },
      progress_history: { orderBy: { created_at: "desc" }, take: 100 },
    },
  });
  if (!t) throw new ServiceError("업무를 찾을 수 없습니다.", 404);
  const logs = await db.activityLog.findMany({ where: { entity_type: "task", entity_id: id }, orderBy: { created_at: "desc" }, take: 100 });
  const userIds = [...new Set([...t.progress_history.map((h) => h.actor_user_id), ...logs.map((l) => l.actor_id)].filter(Boolean) as string[])];
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, display_name: true } });
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.display_name ?? null;
  const readiness = taskReadiness(
    t.dependencies.filter((d) => !d.depends_on.deleted_at).map((d) => ({ type: d.type as DependencyType, predecessor: { title: d.depends_on.title, status: d.depends_on.status, is_completed: d.depends_on.is_completed, effective_progress: effectiveProgress(d.depends_on) } })),
    t.allow_draft_start,
  );
  const res = taskResource(t);
  return {
    task: t,
    effective: effectiveProgress(t),
    readiness,
    history: [
      ...t.progress_history.map((h) => ({ at: h.created_at, kind: "progress" as const, field: h.field, old: h.old_value, new: h.new_value, by: h.actor === "ai" ? "AI" : nameOf(h.actor_user_id), reason: h.reason })),
      ...logs
        .filter((l) => !l.action.startsWith("task.progress") && l.action !== "task.complete" && l.action !== "task.uncomplete")
        .map((l) => ({ at: l.created_at, kind: "activity" as const, action: l.action, by: l.actor_kind === "system" ? "자동" : nameOf(l.actor_id), diff: l.diff })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime()),
    permissions: {
      edit: can(actor, { type: "task.assign" }),
      complete: can(actor, { type: "task.complete", task: res }),
      progress: can(actor, { type: "task.adjustProgress", task: res }),
      leader: isLeader(actor),
    },
  };
}
