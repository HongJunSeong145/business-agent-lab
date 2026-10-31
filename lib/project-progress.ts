import "server-only";
import { prisma } from "@/lib/db";
import { DEPARTMENT_CODES } from "@/lib/design/tokens";
import { effectiveProgress, projectProgress, type ProjectProgress } from "@kgb/rules";

/** 사업별 진척도 계산(주관 국서 기준, D4) — 여러 사업을 한 번에 */
export async function loadProjectProgress(projectIds: string[]): Promise<Map<string, ProjectProgress>> {
  if (projectIds.length === 0) return new Map();
  const [tasks, projects] = await Promise.all([
    prisma.task.findMany({
      where: { project_id: { in: projectIds }, deleted_at: null },
      include: { departments: { where: { role: "lead" }, include: { department: { select: { code: true } } } } },
    }),
    prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, dept_weight_override: true } }),
  ]);
  const out = new Map<string, ProjectProgress>();
  for (const p of projects) {
    const rows = tasks
      .filter((t) => t.project_id === p.id && t.departments[0])
      .map((t) => ({ weight: Number(t.weight), effective: effectiveProgress(t), leadCode: t.departments[0]!.department.code, status: t.status }));
    out.set(p.id, projectProgress(rows, DEPARTMENT_CODES, (p.dept_weight_override as Record<string, number> | null) ?? null));
  }
  return out;
}
