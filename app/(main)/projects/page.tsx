import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/can";
import { FUNDING_LABEL, PROJECT_CATEGORY_LABEL, PROJECT_STATUS_LABEL } from "@/lib/services/projects";
import { loadProjectProgress } from "@/lib/project-progress";
import { dateColumnToString, formatKoreanDate, cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Badge, DemoBadge } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";

export const dynamic = "force-dynamic";

type SP = { status?: string; quarter?: string; funding?: string };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const projects = await prisma.project.findMany({
    where: {
      term_id: user.termId,
      deleted_at: null,
      ...(sp.status && sp.status in PROJECT_STATUS_LABEL ? { status: sp.status } : {}),
      ...(sp.quarter && /^[1-4]$/.test(sp.quarter) ? { quarter: Number(sp.quarter) } : {}),
      ...(sp.funding === "school" || sp.funding === "student_fee" ? { funding_sources: { some: { source: sp.funding } } } : {}),
    },
    include: { funding_sources: true, _count: { select: { tasks: { where: { deleted_at: null } } } } },
    orderBy: [{ event_start: { sort: "asc", nulls: "last" } }, { created_at: "desc" }],
  });
  const progress = await loadProjectProgress(projects.map((p) => p.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">사업</h1>
        {can(user, { type: "project.create" }) ? <ProjectFormDialog trigger={<Button><Plus className="h-4 w-4" /> 사업 만들기</Button>} /> : null}
      </div>
      <nav aria-label="사업 구분" className="flex gap-1 text-sm">
        <Link href="/projects" className={`rounded-lg border px-3 py-1.5 ${sp.status !== "done" ? "border-text font-semibold" : "border-border text-muted"}`}>전체</Link>
        <Link href="/projects?status=done" className={`rounded-lg border px-3 py-1.5 ${sp.status === "done" ? "border-text font-semibold" : "border-border text-muted"}`}>완료된 사업(작업물 보관)</Link>
      </nav>
      <form method="get" className="flex flex-wrap gap-2" aria-label="사업 필터">
        <Select name="status" defaultValue={sp.status ?? ""} className="w-36" aria-label="상태">
          <option value="">모든 상태</option>
          {Object.entries(PROJECT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select name="quarter" defaultValue={sp.quarter ?? ""} className="w-32" aria-label="분기">
          <option value="">모든 분기</option>
          {[1, 2, 3, 4].map((q) => <option key={q} value={q}>{q}분기</option>)}
        </Select>
        <Select name="funding" defaultValue={sp.funding ?? ""} className="w-32" aria-label="재원">
          <option value="">모든 재원</option>
          <option value="school">교비</option>
          <option value="student_fee">학생회비</option>
        </Select>
        <Button type="submit" variant="secondary">적용</Button>
      </form>

      {projects.length === 0 ? (
        <EmptyState title="사업이 없습니다" description="회의록에서 AI가 제안하거나(Phase 5), '사업 만들기'로 직접 만들 수 있습니다." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>{["사업명", "행사일", "분기", "재원", "상태", "업무", "진척도"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {projects.map((p) => {
                const pr = progress.get(p.id);
                const cancelled = p.status === "cancelled";
                return (
                  <tr key={p.id} className="hover:bg-bg">
                    <td className="px-4 py-3">
                      <Link href={`/projects/${p.id}`} className={cn("font-medium hover:underline", cancelled && "text-muted line-through")}>{p.title}</Link>
                      <span className="ml-1 text-xs text-muted">{PROJECT_CATEGORY_LABEL[p.category as keyof typeof PROJECT_CATEGORY_LABEL]}</span>
                      {p.is_demo ? <DemoBadge className="ml-1" /> : null}
                    </td>
                    <td className="tabular px-4 py-3">{p.event_start ? formatKoreanDate(dateColumnToString(p.event_start)) : "-"}</td>
                    <td className="px-4 py-3">{p.quarter ? `${p.quarter}분기` : "-"}</td>
                    <td className="px-4 py-3">{p.funding_sources.map((f) => <Badge key={f.source} className="mr-1">{FUNDING_LABEL[f.source]}</Badge>)}</td>
                    <td className="px-4 py-3"><Badge>{PROJECT_STATUS_LABEL[p.status]}</Badge></td>
                    <td className="tabular px-4 py-3">{p._count.tasks}</td>
                    <td className="tabular px-4 py-3">{pr ? `${Math.round(pr.total)}%` : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
