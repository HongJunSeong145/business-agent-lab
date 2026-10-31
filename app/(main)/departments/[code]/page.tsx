import { todayKst } from "@/lib/clock";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/can";
import { DEPARTMENTS, DEPARTMENT_CODES, type DepartmentCode } from "@/lib/design/tokens";
import { loadTaskRows, type TaskRowData } from "@/lib/task-rows";
import { loadProjectProgress } from "@/lib/project-progress";
import { PROJECT_STATUS_LABEL } from "@/lib/services/projects";
import { TASK_STATUS_LABEL } from "@/lib/services/tasks";
import { kstDateString } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/common/empty-state";
import { ProgressBar } from "@/components/dept/progress-bar";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { TaskRow } from "@/components/tasks/task-row";

export const dynamic = "force-dynamic";

type SP = { assignee?: string; status?: string; from?: string; to?: string; project?: string };

/** 국서 업무 공간 (8-6): 사업별 아코디언(진행 중 펼침, 완료·취소 접힘) + 사업 외 업무 */
export default async function DepartmentPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const user = await requireUser();
  const { code } = await params;
  if (!(DEPARTMENT_CODES as readonly string[]).includes(code)) notFound();
  const dc = code as DepartmentCode;
  const sp = await searchParams;
  const tokens = DEPARTMENTS[dc];
  const dept = await prisma.department.findFirstOrThrow({ where: { term_id: user.termId, code: dc } });

  const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : undefined);
  const where: Prisma.TaskWhereInput = {
    departments: { some: { department_id: dept.id } },
    ...(sp.assignee ? { assignees: { some: { user_id: sp.assignee } } } : {}),
    ...(sp.status && sp.status in TASK_STATUS_LABEL ? { status: sp.status } : {}),
    ...(sp.from || sp.to ? { due_date: { gte: day(sp.from), lte: day(sp.to) } } : {}),
    ...(sp.project ? { project_id: sp.project } : {}),
  };
  const [rows, members, allLead] = await Promise.all([
    loadTaskRows(user, where),
    prisma.membership.findMany({ where: { term_id: user.termId }, include: { user: { select: { id: true, display_name: true } } }, orderBy: { created_at: "asc" } }),
    // 국서 진척도: 주관 업무만, 취소·취소 사업 제외 (D4)
    loadTaskRows(user, { departments: { some: { department_id: dept.id, role: "lead" } }, status: { not: "cancelled" }, OR: [{ project_id: null }, { project: { status: { notIn: ["cancelled"] } } }] }),
  ]);
  const totalW = allLead.reduce((a, r) => a + r.weight, 0);
  const deptProgress = totalW ? allLead.reduce((a, r) => a + r.weight * r.effective, 0) / totalW : 0;

  // 사업별 묶기
  const groups = new Map<string, { project: TaskRowData["project"]; rows: TaskRowData[] }>();
  for (const r of rows) {
    const key = r.project?.id ?? "none";
    if (!groups.has(key)) groups.set(key, { project: r.project, rows: [] });
    groups.get(key)!.rows.push(r);
  }
  const progress = await loadProjectProgress([...groups.keys()].filter((k) => k !== "none"));
  const ordered = [...groups.entries()].sort(([, a], [, b]) => {
    const rank = (g: typeof a) => (!g.project ? 1 : ["done", "cancelled"].includes(g.project.status) ? 2 : 0);
    return rank(a) - rank(b);
  });
  const today = todayKst();
  const filtered = Boolean(sp.assignee || sp.status || sp.from || sp.to || sp.project);

  return (
    <div className="space-y-4">
      <header className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="h-2" style={{ backgroundColor: tokens.base, boxShadow: tokens.fillBorder ? `inset 0 -1px 0 ${tokens.fillBorder}` : undefined }} />
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="min-w-60 flex-1">
            <h1 className="text-xl font-semibold" style={{ color: tokens.ink }}>{tokens.nameKo}</h1>
            <div className="mt-2 max-w-md">
              <ProgressBar code={dc} value={deptProgress} label={`${tokens.nameKo} 진척도`} />
            </div>
          </div>
          {can(user, { type: "task.create" }) ? (
            <TaskFormDialog defaultLeadDepartmentId={dept.id} defaultProjectId={sp.project} trigger={<Button><Plus className="h-4 w-4" /> 업무 추가</Button>} />
          ) : null}
        </div>
      </header>

      <form method="get" className="flex flex-wrap items-center gap-2" aria-label="업무 필터">
        {sp.project ? <input type="hidden" name="project" value={sp.project} /> : null}
        <Select name="assignee" defaultValue={sp.assignee ?? ""} className="w-40" aria-label="담당자">
          <option value="">모든 담당자</option>
          {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.display_name}</option>)}
        </Select>
        <Select name="status" defaultValue={sp.status ?? ""} className="w-32" aria-label="상태">
          <option value="">모든 상태</option>
          {Object.entries(TASK_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Input type="date" name="from" defaultValue={sp.from} className="w-40" aria-label="마감 시작" />
        <Input type="date" name="to" defaultValue={sp.to} className="w-40" aria-label="마감 끝" />
        <Button type="submit" variant="secondary">적용</Button>
        {filtered ? <a href={`/departments/${dc}`} className="text-sm underline">필터 해제</a> : null}
      </form>

      {ordered.length === 0 ? (
        <EmptyState title={filtered ? "조건에 맞는 업무가 없습니다" : "아직 업무가 없습니다"} description="회의록 AI 제안(Phase 5) 또는 '업무 추가'로 업무를 만들 수 있습니다." />
      ) : (
        ordered.map(([key, g]) => {
          const pr = key !== "none" ? progress.get(key) : undefined;
          const closed = g.project && ["done", "cancelled"].includes(g.project.status);
          return (
            <details key={key} open={!closed} className="rounded-xl border border-border bg-surface" data-project-group={key}>
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
                <span className="flex-1 font-semibold">
                  {g.project ? g.project.title : "사업 외 업무"}
                  {g.project ? <span className="ml-2 text-xs font-normal text-muted">{PROJECT_STATUS_LABEL[g.project.status]}</span> : null}
                </span>
                {pr ? <span className="tabular text-sm text-muted">사업 진척도 {Math.round(pr.total)}%</span> : null}
                <span className="text-xs text-muted">{g.rows.length}건</span>
              </summary>
              <ul className="space-y-0.5 border-t border-border p-2">
                {g.rows.map((r) => <TaskRow key={r.id} task={r} today={today} deptCode={dc} />)}
              </ul>
            </details>
          );
        })
      )}
    </div>
  );
}
