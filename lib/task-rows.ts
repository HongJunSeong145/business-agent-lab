import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { can, type Actor } from "@/lib/auth/can";
import { hasPlanDraft, projectsWithPlanDraft } from "@/lib/services/tasks";
import type { DepartmentCode } from "@/lib/design/tokens";
import { dateColumnToString } from "@/lib/utils";
import { effectiveProgress, progressSource, taskReadiness, type DependencyType, type ProgressSource } from "@kgb/rules";

/** 업무 행(국서 공간·사업 보드) 표시용 직렬화 데이터 */
export type TaskRowData = {
  id: string;
  title: string;
  status: string;
  project: { id: string; title: string; status: string } | null;
  departments: { code: DepartmentCode; role: "lead" | "support" }[];
  assignees: { id: string; name: string }[];
  due: string | null;
  dueState: "proposed" | "confirmed";
  dueReason: string | null;
  effective: number;
  source: ProgressSource;
  aiProgress: number | null;
  manualProgress: number | null;
  isCompleted: boolean;
  weight: number;
  blockedReasons: string[];
  startedOnDraft: boolean;
  deliverableCount: number;
  referenceCount: number;
  can: { complete: boolean; progress: boolean; upload: boolean };
};

export async function loadTaskRows(actor: Actor & { termId: string }, where: Prisma.TaskWhereInput): Promise<TaskRowData[]> {
  const tasks = await prisma.task.findMany({
    where: { deleted_at: null, departments: { some: { role: "lead", department: { term_id: actor.termId } } }, ...where },
    include: {
      project: { select: { id: true, title: true, status: true } },
      departments: { include: { department: { select: { code: true } } } },
      assignees: { include: { user: { select: { id: true, display_name: true } } } },
      dependencies: { include: { depends_on: { select: { title: true, status: true, is_completed: true, ai_progress: true, manual_progress: true, deleted_at: true, template_key: true, project_id: true } } } },
      _count: { select: { deliverables: { where: { deleted_at: null } }, reference_items: { where: { deleted_at: null } } } },
    },
    orderBy: [{ due_date: { sort: "asc", nulls: "last" } }, { created_at: "asc" }],
  });
  const drafts = await projectsWithPlanDraft(prisma, tasks.flatMap((t) => t.dependencies.map((d) => d.depends_on.project_id)));
  return tasks.map((t) => {
    const res = { assigneeIds: t.assignees.map((a) => a.user_id), departmentIds: t.departments.map((d) => d.department_id) };
    const r = taskReadiness(
      t.dependencies.filter((d) => !d.depends_on.deleted_at).map((d) => ({ type: d.type as DependencyType, predecessor: { title: d.depends_on.title, status: d.depends_on.status, is_completed: d.depends_on.is_completed, effective_progress: effectiveProgress(d.depends_on), has_draft: hasPlanDraft(d.depends_on, drafts) } })),
      t.allow_draft_start,
    );
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      project: t.project,
      departments: t.departments
        .map((d) => ({ code: d.department.code as DepartmentCode, role: d.role as "lead" | "support" }))
        .sort((a, b) => (a.role === b.role ? 0 : a.role === "lead" ? -1 : 1)),
      assignees: t.assignees.map((a) => ({ id: a.user.id, name: a.user.display_name })),
      due: t.due_date ? dateColumnToString(t.due_date) : null,
      dueState: t.due_state as "proposed" | "confirmed",
      dueReason: t.due_reason,
      effective: effectiveProgress(t),
      source: progressSource(t),
      aiProgress: t.ai_progress,
      manualProgress: t.manual_progress,
      isCompleted: t.is_completed,
      weight: Number(t.weight),
      blockedReasons: t.status === "blocked" ? r.reasons : [],
      startedOnDraft: t.started_on_draft_plan,
      deliverableCount: t._count.deliverables,
      referenceCount: t._count.reference_items,
      can: {
        complete: can(actor, { type: "task.complete", task: res }),
        progress: can(actor, { type: "task.adjustProgress", task: res }),
        upload: can(actor, { type: "deliverable.upload", task: res }) && t.status !== "cancelled",
      },
    };
  });
}
