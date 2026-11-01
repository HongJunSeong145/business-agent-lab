import { z } from "zod";
import type { Db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { assertCan, type Actor } from "@/lib/auth/can";
import { writeAudit } from "@/lib/audit/log";
import { ServiceError } from "./invitations";
import { insertProjectTx, parseProject } from "./projects";
import { insertTaskTx, linkTemplateDependencies, parseTask, recomputeReadiness, syncProjectCompletion } from "./tasks";
import { recalcProjectSchedule } from "./schedule";
import { notifyLeaders } from "./notifications";

/**
 * AI 제안 검토·승인 (8-4, PART 7 단계 7·8): 승인한 항목만 한 트랜잭션으로 실제 사업·업무가 된다.
 *  - 수정 후 승인 → edited_approved, 수정한 마감은 확정(D2), 수정 없이 승인한 마감은 제안 유지(N4)
 *  - 새 사업 제안이 승인되지 않으면 그 사업의 업무 제안도 승인할 수 없다
 */
type ActorT = Actor & { termId: string };
type Tx = Prisma.TransactionClient;

const dept = z.enum(["planning", "finance", "secretariat", "promotion", "operations"]);
const date = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]);

export const decisionSchema = z.object({
  approve: z
    .array(
      z.object({
        id: z.string().uuid(),
        edits: z
          .object({
            title: z.string().trim().min(1).max(150).optional(),
            event_start: date.optional(),
            lead_department: dept.optional(),
            support_departments: z.array(dept).max(4).optional(),
            due_date: date.optional(),
          })
          .optional(),
      }),
    )
    .max(300)
    .default([]),
  reject: z.array(z.string().uuid()).max(300).default([]),
  /** 검토 화면에서 사람이 직접 추가한 업무(제안에 빠진 일) — 승인과 같은 트랜잭션에서 만든다 */
  create: z
    .array(
      z.object({
        project_key: z.string().max(200).nullable(),
        title: z.string().trim().min(1, "업무명을 입력하세요.").max(150),
        lead_department: dept,
        support_departments: z.array(dept).max(4).default([]),
        due_date: date.default(null),
      }),
    )
    .max(50)
    .default([]),
});

export type DecisionInput = z.input<typeof decisionSchema>;

type NewProjectPayload = { title: string; category: string; event_start: string | null; venue: string | null; expected_beneficiaries: number | null; funding: ("school" | "student_fee")[]; uses_external_vendor: boolean };
type NewTaskPayload = {
  title: string; description: string | null; lead_department: string; support_departments: string[]; template_key: string | null;
  assignee_ids: string[]; due_date: string | null; due_reason: string | null; due_feasible: boolean; acceptance_criteria: { text: string; done: boolean }[];
  project_id: string | null;
};
type DeadlinePayload = { due_date: string; reason: string | null; requested_by: string };

export async function listPendingProposals(db: Db, termId: string) {
  return db.proposal.findMany({ where: { term_id: termId, status: "pending" }, orderBy: [{ created_at: "asc" }] });
}

export async function decideProposals(db: Db, actor: ActorT, raw: unknown) {
  assertCan(actor, { type: "proposal.approve" });
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError(parsed.error.issues[0]?.message ?? "입력값 오류");
  const { approve, reject, create } = parsed.data;
  if (approve.length + reject.length + create.length === 0) throw new ServiceError("선택한 제안이 없습니다.");

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`propose:${actor.termId}`}))`;
    const ids = [...approve.map((a) => a.id), ...reject];
    const props = await tx.proposal.findMany({ where: { id: { in: ids }, term_id: actor.termId } });
    if (props.length !== new Set(ids).size) throw new ServiceError("찾을 수 없는 제안이 있습니다.", 404);
    const notPending = props.find((p) => p.status !== "pending");
    if (notPending) throw new ServiceError("이미 처리되었거나 대체된 제안이 있습니다. 화면을 새로고침하세요.", 409);
    const byId = new Map(props.map((p) => [p.id, p]));
    const depts = Object.fromEntries((await tx.department.findMany({ where: { term_id: actor.termId } })).map((d) => [d.code, d.id]));
    const now = new Date();
    const projectIdOfKey = new Map<string, string>();
    const touchedProjects = new Set<string>();
    const created = { projects: 0, tasks: 0, updates: 0, deadlines: 0, skipped: 0 };
    // 대상 업무가 이미 삭제된 제안은 막지 않고 건너뛴다(다른 항목 승인은 그대로 진행) — 실시간 수정·삭제와 충돌 방지
    const skip = async (id: string) => {
      await tx.proposal.update({ where: { id }, data: { status: "superseded", decided_by: actor.userId, decided_at: new Date() } });
      created.skipped++;
    };

    const mark = (id: string, edited: boolean) =>
      tx.proposal.update({ where: { id }, data: { status: edited ? "edited_approved" : "approved", decided_by: actor.userId, decided_at: now } });

    // 승인된 이전 제안으로 이미 만들어진 사업(같은 project_key) 찾기
    const priorProjects = await tx.proposal.findMany({ where: { term_id: actor.termId, kind: "new_project", status: { in: ["approved", "edited_approved"] }, project_key: { in: props.map((p) => p.project_key).filter(Boolean) as string[] } } });
    const priorIds = priorProjects.map((pp) => (pp.payload as { created_project_id?: string }).created_project_id).filter(Boolean) as string[];
    const alive = new Set((await tx.project.findMany({ where: { id: { in: priorIds }, deleted_at: null }, select: { id: true } })).map((x) => x.id));
    for (const pp of priorProjects) {
      const pid = (pp.payload as { created_project_id?: string }).created_project_id;
      if (pid && alive.has(pid) && pp.project_key) projectIdOfKey.set(pp.project_key, pid);
    }

    // 1) 사업
    const order = (k: string) => ["new_project", "update_project", "cancel", "update_task", "new_task", "deadline"].indexOf(k);
    const approvals = [...approve].sort((a, b) => order(byId.get(a.id)!.kind) - order(byId.get(b.id)!.kind));
    for (const a of approvals) {
      const p = byId.get(a.id)!;
      const edited = Boolean(a.edits && Object.keys(a.edits).length);
      if (p.kind === "new_project") {
        const pl = p.payload as NewProjectPayload;
        const v = parseProject({
          title: a.edits?.title ?? pl.title, category: pl.category, event_start: a.edits?.event_start !== undefined ? a.edits.event_start : pl.event_start,
          venue: pl.venue ?? undefined, expected_beneficiaries: pl.expected_beneficiaries, uses_external_vendor: pl.uses_external_vendor,
          funding: pl.funding.map((source) => ({ source, amount_planned: 0 })),
        });
        const proj = await insertProjectTx(tx, actor, v, { created_from_meeting_id: p.source_type === "meeting" ? p.source_id : null });
        projectIdOfKey.set(p.project_key!, proj.id);
        if (!v.event_start) {
          await notifyLeaders(tx, actor.termId, { type: "event_date_missing", title: `행사일 미정: ${proj.title}`, body: "회의록에 행사 당일 날짜가 없습니다. 사업 화면에서 행사일을 넣으면 마감이 계산됩니다.", link: `/projects/${proj.id}`, severity: "warn", dedupeKey: `event-date:${proj.id}` });
        }
        touchedProjects.add(proj.id);
        await tx.proposal.update({ where: { id: p.id }, data: { payload: { ...pl, created_project_id: proj.id } as Prisma.InputJsonValue } });
        await mark(p.id, edited);
        created.projects++;
      } else if (p.kind === "update_project") {
        const ch = (p.payload as { changes: Record<string, unknown> }).changes;
        const cur = await tx.project.findFirst({ where: { id: p.target_id!, term_id: actor.termId, deleted_at: null }, include: { funding_sources: true } });
        if (!cur || cur.status === "cancelled") {
          await skip(p.id);
          continue;
        }
        const data: Prisma.ProjectUpdateInput = {};
        if ("event_start" in ch) {
          data.event_start = ch.event_start ? new Date(`${ch.event_start}T00:00:00Z`) : null;
          data.event_end = data.event_start;
        }
        if ("venue" in ch) data.venue = ch.venue as string | null;
        if ("expected_beneficiaries" in ch) data.expected_beneficiaries = ch.expected_beneficiaries as number | null;
        if ("uses_external_vendor" in ch) data.uses_external_vendor = Boolean(ch.uses_external_vendor);
        await tx.project.update({ where: { id: cur.id }, data });
        if (Array.isArray(ch.funding)) {
          const want = ch.funding as string[];
          await tx.projectFundingSource.deleteMany({ where: { project_id: cur.id, source: { notIn: want } } });
          for (const s of want) if (!cur.funding_sources.some((f) => f.source === s)) await tx.projectFundingSource.create({ data: { project_id: cur.id, source: s } });
        }
        await writeAudit(tx, { actorId: actor.userId, action: "project.update", entityType: "project", entityId: cur.id, diff: { before: p.before_snapshot, after: ch, via_proposal: p.id } });
        touchedProjects.add(cur.id);
        await mark(p.id, false);
        created.updates++;
      } else if (p.kind === "new_task") {
        const pl = p.payload as NewTaskPayload;
        const projectId = pl.project_id ?? (p.project_key ? projectIdOfKey.get(p.project_key) ?? null : null);
        if (p.project_key && !projectId) {
          // 기존 사업이 그사이 삭제·취소됐으면 건너뜀(다른 항목은 계속), 새 사업 제안이 승인 안 됐으면 안내
          if (/^[0-9a-f-]{36}$/.test(p.project_key) && (await tx.project.findFirst({ where: { id: p.project_key, OR: [{ deleted_at: { not: null } }, { status: "cancelled" }] } }))) {
            await skip(p.id);
            continue;
          }
          throw new ServiceError(`'${pl.title}': 이 업무의 사업 제안을 먼저(또는 함께) 승인하세요.`);
        }
        const lead = a.edits?.lead_department ?? pl.lead_department;
        const support = (a.edits?.support_departments ?? pl.support_departments).filter((d) => d !== lead);
        const due = a.edits?.due_date !== undefined ? a.edits.due_date : pl.due_date;
        const dueEdited = a.edits?.due_date !== undefined && a.edits.due_date !== pl.due_date;
        const assignees = (await tx.membership.findMany({ where: { term_id: actor.termId, user_id: { in: pl.assignee_ids } }, select: { user_id: true } })).map((m) => m.user_id);
        const v = parseTask({
          title: a.edits?.title ?? pl.title, description: pl.description, project_id: projectId, lead_department_id: depts[lead], support_department_ids: support.map((d) => depts[d]),
          assignee_ids: assignees, due_date: due, acceptance_criteria: pl.acceptance_criteria,
        });
        await insertTaskTx(tx, actor, v, {
          template_key: pl.template_key,
          due_state: dueEdited ? "confirmed" : "proposed",
          due_reason: dueEdited ? "검토 화면에서 수정" : pl.due_reason,
          due_feasible: dueEdited ? true : pl.due_feasible,
          source_proposal_id: p.id,
        });
        if (projectId) touchedProjects.add(projectId);
        await mark(p.id, edited);
        created.tasks++;
      } else if (p.kind === "deadline") {
        const pl = p.payload as DeadlinePayload;
        const task = await tx.task.findFirst({ where: { id: p.target_id!, deleted_at: null } });
        if (!task) {
          await skip(p.id);
          continue;
        }
        const due = a.edits?.due_date ?? pl.due_date;
        await tx.task.update({ where: { id: task.id }, data: { due_date: new Date(`${due}T00:00:00Z`), due_state: "confirmed", due_reason: `마감 변경 요청 승인${pl.reason ? ` — ${pl.reason}` : ""}` } });
        await writeAudit(tx, { actorId: actor.userId, action: "task.update", entityType: "task", entityId: task.id, diff: { before: { due_date: task.due_date }, after: { due_date: due }, via_proposal: p.id } });
        await tx.notification.create({ data: { user_id: pl.requested_by, type: "deadline_request", title: `'${task.title}' 마감 변경 요청이 승인되었습니다 (${due})`, link: `/?task=${task.id}` } }).catch(() => undefined);
        if (task.project_id) touchedProjects.add(task.project_id);
        await mark(p.id, Boolean(a.edits?.due_date));
        created.deadlines++;
      } else if (p.kind === "update_task") {
        // 결재 기획안 기준 업무 수정
        const ch = { ...(p.payload as { changes: Record<string, unknown> }).changes };
        if (a.edits?.title) ch.title = a.edits.title;
        if (a.edits?.lead_department) ch.lead_department = a.edits.lead_department;
        if (a.edits?.support_departments) ch.support_departments = a.edits.support_departments;
        if (a.edits?.due_date !== undefined) ch.due_date = a.edits.due_date;
        const task = await tx.task.findFirst({ where: { id: p.target_id!, deleted_at: null }, include: { departments: true } });
        if (!task) {
          await skip(p.id);
          continue;
        }
        const data: Prisma.TaskUpdateInput = {};
        if (typeof ch.title === "string") data.title = ch.title;
        if (typeof ch.description === "string") data.description = ch.description;
        if ("due_date" in ch) {
          data.due_date = ch.due_date ? new Date(`${ch.due_date}T00:00:00Z`) : null;
          data.due_state = "confirmed";
          data.due_reason = p.source_type === "plan" ? "결재 기획안 기준 재배정" : p.source_type === "meeting" ? "회의록 기한" : "검토 화면에서 수정";
        }
        await tx.task.update({ where: { id: task.id }, data });
        if (ch.lead_department || ch.support_departments) {
          const leadCode = (ch.lead_department as string | undefined) ?? Object.entries(depts).find(([, id]) => id === task.departments.find((d) => d.role === "lead")?.department_id)?.[0];
          const leadId = depts[leadCode!]!;
          const sup = ((ch.support_departments as string[] | undefined) ?? task.departments.filter((d) => d.role === "support").map((d) => Object.entries(depts).find(([, id]) => id === d.department_id)?.[0]).filter(Boolean) as string[])
            .map((c) => depts[c]!)
            .filter((id) => id && id !== leadId);
          await tx.taskDepartment.deleteMany({ where: { task_id: task.id } });
          await tx.taskDepartment.createMany({ data: [{ task_id: task.id, department_id: leadId, role: "lead" }, ...[...new Set(sup)].map((d) => ({ task_id: task.id, department_id: d, role: "support" }))] });
        }
        await writeAudit(tx, { actorId: actor.userId, action: "task.update", entityType: "task", entityId: task.id, diff: { before: p.before_snapshot, after: ch, via_proposal: p.id } });
        if (task.project_id) touchedProjects.add(task.project_id);
        await mark(p.id, edited);
        created.updates++;
      } else if (p.kind === "cancel") {
        const task = await tx.task.findFirst({ where: { id: p.target_id!, deleted_at: null } });
        if (!task) {
          await skip(p.id);
          continue;
        }
        if (!task.is_completed && task.status !== "cancelled") {
          await tx.task.update({ where: { id: task.id }, data: { status: "cancelled" } });
          await writeAudit(tx, { actorId: actor.userId, action: "task.update", entityType: "task", entityId: task.id, diff: { before: { status: task.status }, after: { status: "cancelled" }, reason: (p.payload as { reason?: string }).reason, via_proposal: p.id } });
        }
        if (task.project_id) touchedProjects.add(task.project_id);
        await mark(p.id, false);
        created.updates++;
      } else {
        throw new ServiceError("지원하지 않는 제안 종류입니다.");
      }
    }

    // 1-2) 사람이 직접 추가한 업무
    for (const c of create) {
      const isUuid = c.project_key && /^[0-9a-f-]{36}$/.test(c.project_key);
      let projectId: string | null = null;
      if (c.project_key) {
        projectId = projectIdOfKey.get(c.project_key) ?? null;
        if (!projectId && isUuid) projectId = (await tx.project.findFirst({ where: { id: c.project_key, term_id: actor.termId, deleted_at: null }, select: { id: true } }))?.id ?? null;
        if (!projectId) throw new ServiceError(`'${c.title}': 이 업무의 사업 제안을 함께 승인하세요.`);
      }
      const { guessTemplate } = await import("@/lib/ai/propose");
      const tpl = guessTemplate(c.title, c.lead_department);
      const tplFree = tpl && projectId ? !(await tx.task.count({ where: { project_id: projectId, template_key: tpl, deleted_at: null } })) : false;
      const v = parseTask({ title: c.title, project_id: projectId, lead_department_id: depts[c.lead_department], support_department_ids: c.support_departments.filter((d) => d !== c.lead_department).map((d) => depts[d]), due_date: c.due_date });
      await insertTaskTx(tx, actor, v, {
        template_key: tplFree ? tpl : null,
        due_state: c.due_date ? "confirmed" : "proposed",
        due_reason: c.due_date ? "검토 화면에서 직접 추가" : null,
      });
      if (projectId) touchedProjects.add(projectId);
      created.tasks++;
    }

    // 2) 거절
    if (reject.length) {
      await tx.proposal.updateMany({ where: { id: { in: reject } }, data: { status: "rejected", decided_by: actor.userId, decided_at: now } });
      for (const id of reject) {
        const p = byId.get(id)!;
        if (p.kind === "deadline") {
          const pl = p.payload as DeadlinePayload;
          await tx.notification.create({ data: { user_id: pl.requested_by, type: "deadline_request", title: "마감 변경 요청이 반려되었습니다", link: p.target_id ? `/?task=${p.target_id}` : null } }).catch(() => undefined);
        }
      }
    }
    await writeAudit(tx, { actorId: actor.userId, action: "proposal.decide", entityType: "proposal", entityId: null, diff: { approved: approve.map((a) => a.id), rejected: reject, ...created } });

    // 3) 사업별 표준 업무 의존관계 연결 → 차단 계산 → 제안 마감 재계산
    for (const pid of touchedProjects) {
      await linkTemplateDependencies(tx, actor.termId, pid);
      await recalcProjectSchedule(tx, actor.termId, pid, "proposed");
    }
    const all = await tx.task.findMany({ where: { project_id: { in: [...touchedProjects] }, deleted_at: null }, select: { id: true } });
    await recomputeReadiness(tx, actor.termId, { taskIds: all.map((t) => t.id) });
    for (const pid of touchedProjects) await syncProjectCompletion(tx, actor.termId, pid);

    // 4) 처리 끝난 회의록은 reviewed
    const meetings = [...new Set(props.filter((p) => p.source_type === "meeting" && p.source_id).map((p) => p.source_id!))];
    for (const m of meetings) {
      const left = await tx.proposal.count({ where: { source_type: "meeting", source_id: m, status: "pending" } });
      if (left === 0) await tx.meeting.updateMany({ where: { id: m, status: "analyzed" }, data: { status: "reviewed" } });
    }
    return { ...created, rejected: reject.length, projectIds: [...touchedProjects] };
  });
}

/** 국원의 마감 변경 요청 (Q5, ADR-017): proposals(kind=deadline, source=manual) → 검토 화면에서 승인 */
export const deadlineRequestSchema = z.object({ due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜를 선택하세요."), reason: z.string().trim().max(300).optional().transform((v) => v || null) });

export async function requestDeadlineChange(db: Db, actor: ActorT, taskId: string, raw: unknown) {
  const r = deadlineRequestSchema.safeParse(raw);
  if (!r.success) throw new ServiceError(r.error.issues[0]?.message ?? "입력값 오류");
  const task = await db.task.findFirst({
    where: { id: taskId, deleted_at: null, departments: { some: { role: "lead", department: { term_id: actor.termId } } } },
    include: { assignees: true, departments: true },
  });
  if (!task) throw new ServiceError("업무를 찾을 수 없습니다.", 404);
  assertCan(actor, { type: "task.requestDeadlineChange", task: { assigneeIds: task.assignees.map((a) => a.user_id), departmentIds: task.departments.map((d) => d.department_id) } });
  return db.$transaction(async (tx: Tx) => {
    await tx.proposal.updateMany({ where: { kind: "deadline", target_id: taskId, status: "pending", source_type: "manual" }, data: { status: "superseded" } });
    const p = await tx.proposal.create({
      data: {
        term_id: actor.termId, source_type: "manual", source_id: actor.userId, kind: "deadline", target_id: taskId,
        payload: { due_date: r.data.due_date, reason: r.data.reason, requested_by: actor.userId, title: task.title } as Prisma.InputJsonValue,
        before_snapshot: { due_date: task.due_date?.toISOString().slice(0, 10) ?? null } as Prisma.InputJsonValue,
        inferred: false, confidence: 1, dedupe_key: `deadline:${taskId}:${r.data.due_date}`,
      },
    });
    await writeAudit(tx, { actorId: actor.userId, action: "task.deadline_request", entityType: "task", entityId: taskId, diff: r.data });
    await notifyLeaders(tx, actor.termId, { type: "deadline_request", title: `'${task.title}' 마감 변경 요청`, body: `${r.data.due_date}${r.data.reason ? ` — ${r.data.reason}` : ""}`, link: "/review", dedupeKey: `deadline-req:${p.id}` });
    return p;
  });
}
