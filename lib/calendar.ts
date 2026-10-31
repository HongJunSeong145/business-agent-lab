import "server-only";
import { prisma } from "@/lib/db";
import { can, type Actor } from "@/lib/auth/can";
import type { DepartmentCode } from "@/lib/design/tokens";
import { addDays } from "@kgb/rules";
import { dateColumnToString } from "@/lib/utils";

/**
 * 캘린더 피드 (8-2 ②, ADR-012 단일 원천): 사업 행사일(projects) + 업무 마감(tasks) + 마일스톤·사용자 일정(schedule_events).
 * 날짜를 복제 저장하지 않고 조회 시 합친다. (미승인 AI 제안 고스트 항목은 Phase 5 에서 추가)
 */
export type CalendarItem = {
  id: string;
  kind: "event_day" | "deadline" | "milestone" | "custom";
  title: string;
  start: string; // YYYY-MM-DD
  end: string | null; // 포함(inclusive) 종료일
  state: "proposed" | "confirmed";
  deptCode: DepartmentCode | null;
  cancelled: boolean;
  completed: boolean;
  feasible: boolean;
  editable: boolean;
  link: { type: "task" | "project" | "review"; id: string } | null;
  /** 아직 승인 전인 AI 제안(고스트 항목, D2) */
  ghost: boolean;
  projectTitle: string | null;
};

export async function loadCalendar(actor: Actor & { termId: string }, from: string, to: string): Promise<CalendarItem[]> {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  const leader = can(actor, { type: "project.confirmSchedule" });
  const [projects, tasks, events, proposals] = await Promise.all([
    prisma.project.findMany({
      where: { term_id: actor.termId, deleted_at: null, event_start: { lte: t }, OR: [{ event_end: { gte: f } }, { event_end: null, event_start: { gte: f } }] },
    }),
    prisma.task.findMany({
      where: { deleted_at: null, due_date: { gte: f, lte: t }, departments: { some: { role: "lead", department: { term_id: actor.termId } } } },
      include: { departments: { where: { role: "lead" }, include: { department: { select: { code: true } } } }, project: { select: { title: true, status: true } } },
    }),
    prisma.scheduleEvent.findMany({ where: { term_id: actor.termId, start: { gte: f, lte: t } }, include: { project: { select: { title: true, status: true } } } }),
    prisma.proposal.findMany({ where: { term_id: actor.termId, status: "pending", kind: "new_task" } }),
  ]);
  const items: CalendarItem[] = [];
  for (const p of projects) {
    const s = dateColumnToString(p.event_start!);
    items.push({
      id: `project:${p.id}`, kind: "event_day", title: p.title, start: s, end: p.event_end ? dateColumnToString(p.event_end) : s,
      state: "confirmed", deptCode: null, cancelled: p.status === "cancelled", completed: p.status === "done", feasible: true,
      editable: leader && p.status !== "cancelled", link: { type: "project", id: p.id }, projectTitle: null, ghost: false,
    });
  }
  for (const x of tasks) {
    const cancelled = x.status === "cancelled" || x.project?.status === "cancelled";
    items.push({
      id: `task:${x.id}`, kind: "deadline", title: x.title, start: dateColumnToString(x.due_date!), end: null,
      state: x.due_state as "proposed" | "confirmed", deptCode: (x.departments[0]?.department.code ?? null) as DepartmentCode | null,
      cancelled, completed: x.is_completed, feasible: x.due_feasible,
      editable: leader && !cancelled && !x.is_completed, link: { type: "task", id: x.id }, projectTitle: x.project?.title ?? null, ghost: false,
    });
  }
  for (const e of events) {
    items.push({
      id: `se:${e.id}`, kind: e.kind === "milestone" ? "milestone" : "custom", title: e.title, start: e.start.toISOString().slice(0, 10), end: null,
      state: e.state as "proposed" | "confirmed", deptCode: null, cancelled: e.project?.status === "cancelled", completed: false,
      feasible: !e.title.includes("일정 불가"), editable: false, link: e.project_id ? { type: "project", id: e.project_id } : null, projectTitle: e.project?.title ?? null, ghost: false,
    });
  }
  for (const p of proposals) {
    const pl = p.payload as { title?: string; due_date?: string | null; lead_department?: string; due_feasible?: boolean; project_title?: string | null };
    if (!pl.due_date || pl.due_date < from || pl.due_date > to) continue;
    items.push({
      id: `proposal:${p.id}`, kind: "deadline", title: pl.title ?? "AI 제안", start: pl.due_date, end: null, state: "proposed",
      deptCode: (pl.lead_department ?? null) as DepartmentCode | null, cancelled: false, completed: false, feasible: pl.due_feasible !== false,
      editable: false, link: { type: "review", id: p.id }, projectTitle: pl.project_title ?? null, ghost: true,
    });
  }
  return items;
}

export { addDays };
