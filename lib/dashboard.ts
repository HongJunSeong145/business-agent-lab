import { todayKst } from "@/lib/clock";
import "server-only";
import { prisma } from "@/lib/db";
import { DEPARTMENTS, DEPARTMENT_CODES, type DepartmentCode } from "@/lib/design/tokens";
import { dateColumnToString } from "@/lib/utils";
import { addDays, defaultQuarter, effectiveProgress, type Quarter } from "@kgb/rules";
import { loadProjectProgress } from "@/lib/project-progress";

const OPEN_STATUSES = ["blocked", "todo", "in_progress", "review"];

export type DeptCard = {
  code: DepartmentCode;
  id: string;
  name: string;
  progress: number;
  inProgress: number;
  overdue: number;
  review: number;
  urgent: { id: string; title: string; due: string | null; progress: number }[];
};

/** 메인 대시보드 데이터 (8-2) — 모든 값은 DB 실데이터. 하드코딩된 가짜 값 없음. */
export async function loadDashboard(termId: string) {
  const today = todayKst();
  const in30 = addDays(today, 30);

  const [term, meetings, departments, upcomingTasks, nextProject, profiles, contactColumns, contactRows] = await Promise.all([
    prisma.term.findUniqueOrThrow({ where: { id: termId }, include: { council: true } }),
    prisma.meeting.findMany({
      where: { term_id: termId, deleted_at: null },
      orderBy: [{ meeting_date: "desc" }, { created_at: "desc" }],
      take: 7,
    }),
    prisma.department.findMany({ where: { term_id: termId }, orderBy: { display_order: "asc" } }),
    prisma.task.findMany({
      where: {
        deleted_at: null,
        status: { in: OPEN_STATUSES },
        due_date: { gte: new Date(`${today}T00:00:00Z`), lte: new Date(`${in30}T00:00:00Z`) },
        departments: { some: { department: { term_id: termId } } },
      },
      include: { departments: { include: { department: true } }, assignees: { include: { user: true } }, project: { select: { title: true, status: true } } },
      orderBy: { due_date: "asc" },
      take: 50,
    }),
    prisma.project.findFirst({
      where: { term_id: termId, deleted_at: null, status: { notIn: ["cancelled", "done"] }, event_start: { gte: new Date(`${today}T00:00:00Z`) } },
      orderBy: { event_start: "asc" },
      include: { funding_sources: true },
    }),
    prisma.memberProfile.findMany({ where: { term_id: termId, deleted_at: null }, orderBy: { display_order: "asc" } }),
    prisma.contactColumn.findMany({ where: { term_id: termId, deleted_at: null }, orderBy: { display_order: "asc" } }),
    prisma.contactRow.findMany({ where: { term_id: termId, deleted_at: null }, orderBy: { display_order: "asc" } }),
  ]);

  const milestones = await prisma.scheduleEvent.findMany({
    where: { term_id: termId, start: { gte: new Date(`${today}T00:00:00Z`), lte: new Date(`${in30}T00:00:00Z`) }, project: { status: { not: "cancelled" } } },
    include: { project: { select: { title: true } } },
  });

  // 국서 카드: 주관(lead) 업무만 집계 (D4, D10)
  const leadTasks = await prisma.taskDepartment.findMany({
    where: {
      role: "lead",
      department: { term_id: termId },
      task: { deleted_at: null, status: { not: "cancelled" }, OR: [{ project_id: null }, { project: { status: { notIn: ["cancelled", "done"] } } }] },
    },
    include: { task: true },
  });

  const deptCards: DeptCard[] = DEPARTMENT_CODES.map((code) => {
    const d = departments.find((x) => x.code === code)!;
    const tasks = leadTasks.filter((lt) => lt.department_id === d.id).map((lt) => lt.task);
    const totalW = tasks.reduce((s, t) => s + Number(t.weight), 0);
    const progress = totalW === 0 ? 0 : tasks.reduce((s, t) => s + Number(t.weight) * effectiveProgress(t), 0) / totalW;
    const open = tasks.filter((t) => OPEN_STATUSES.includes(t.status));
    const isOverdue = (t: (typeof tasks)[number]) => t.due_date !== null && dateColumnToString(t.due_date) < today;
    const urgent = [...open]
      .filter((t) => t.due_date)
      .sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || a.due_date!.getTime() - b.due_date!.getTime())
      .slice(0, 3)
      .map((t) => ({ id: t.id, title: t.title, due: t.due_date ? dateColumnToString(t.due_date) : null, progress: effectiveProgress(t) }));
    return {
      code,
      id: d.id,
      name: d.name_ko,
      progress,
      inProgress: open.filter((t) => t.status === "in_progress").length,
      overdue: open.filter(isOverdue).length,
      review: open.filter((t) => t.status === "review").length,
      urgent,
    };
  });

  const termQuarters = {
    q1_start: dateColumnToString(term.q1_start), q1_end: dateColumnToString(term.q1_end),
    q2_start: dateColumnToString(term.q2_start), q2_end: dateColumnToString(term.q2_end),
    q3_start: dateColumnToString(term.q3_start), q3_end: dateColumnToString(term.q3_end),
    q4_start: dateColumnToString(term.q4_start), q4_end: dateColumnToString(term.q4_end),
  };

  return {
    today,
    term,
    termQuarters,
    currentQuarter: defaultQuarter(termQuarters, today) as Quarter,
    meetings,
    deptCards,
    upcoming: [
      ...upcomingTasks
        .filter((t) => t.project?.status !== "cancelled")
        .map((t) => {
          const lead = t.departments.find((x) => x.role === "lead");
          return {
            id: t.id,
            kind: "deadline" as const,
            title: t.title,
            due: dateColumnToString(t.due_date!),
            dueState: t.due_state as "proposed" | "confirmed",
            leadCode: (lead?.department.code ?? null) as DepartmentCode | null,
            assignees: t.assignees.map((a) => a.user.display_name),
            feasible: t.due_feasible,
            projectTitle: t.project?.title ?? null,
          };
        }),
      ...milestones.map((e) => ({
        id: e.id,
        kind: "milestone" as const,
        title: e.title,
        due: e.start.toISOString().slice(0, 10),
        dueState: e.state as "proposed" | "confirmed",
        leadCode: null,
        assignees: [],
        feasible: !e.title.includes("일정 불가"),
        projectTitle: e.project?.title ?? null,
      })),
    ].sort((a, b) => a.due.localeCompare(b.due)),
    nextProject: nextProject
      ? { id: nextProject.id, title: nextProject.title, event_start: nextProject.event_start, funding: nextProject.funding_sources.map((f) => (f.source === "school" ? "교비" : "학생회비")) }
      : null,
    nextProjectProgress: nextProject ? ((await loadProjectProgress([nextProject.id])).get(nextProject.id) ?? null) : null,
    profiles,
    contactColumns,
    contactRows,
  };
}

export { DEPARTMENTS };
