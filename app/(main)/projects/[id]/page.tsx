import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/can";
import { FUNDING_LABEL, PROJECT_CATEGORY_LABEL, PROJECT_STATUS_LABEL } from "@/lib/services/projects";
import { loadProjectProgress } from "@/lib/project-progress";
import { loadTaskRows } from "@/lib/task-rows";
import { DEPARTMENTS, DEPARTMENT_CODES } from "@/lib/design/tokens";
import { dateColumnToString, formatKoreanDate, cn } from "@/lib/utils";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/common/badges";
import { ComingSoon } from "@/components/common/empty-state";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { ProjectActions } from "@/components/projects/project-actions";
import { ProjectProgressBar } from "@/components/projects/project-progress-bar";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";

export const dynamic = "force-dynamic";

const ACTION: Record<string, string> = {
  "project.create": "사업 생성", "project.update": "사업 정보 수정", "project.status": "상태 변경", "project.cancel": "사업 취소",
};

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const p = await prisma.project.findFirst({ where: { id, term_id: user.termId, deleted_at: null }, include: { funding_sources: true } });
  if (!p) notFound();
  const [rows, progress, logs, deps] = await Promise.all([
    loadTaskRows(user, { project_id: id }),
    loadProjectProgress([id]),
    prisma.activityLog.findMany({ where: { entity_type: "project", entity_id: id }, orderBy: { created_at: "desc" }, take: 30 }),
    prisma.taskDependency.findMany({
      where: { task: { project_id: id, deleted_at: null }, depends_on: { deleted_at: null } },
      include: { task: { select: { title: true } }, depends_on: { select: { title: true } } },
    }),
  ]);
  const canEdit = can(user, { type: "project.confirmSchedule" }) && p.status !== "cancelled";
  const s = (d: Date | null) => (d ? dateColumnToString(d) : "");
  const fund = (k: string) => p.funding_sources.find((f) => f.source === k)?.amount_planned.toString() ?? "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/projects" className="text-sm text-muted hover:underline">← 사업 목록</Link>
          <h1 className={cn("text-xl font-semibold", p.status === "cancelled" && "text-muted line-through")}>{p.title}</h1>
          <p className="text-sm text-muted">
            {PROJECT_CATEGORY_LABEL[p.category as keyof typeof PROJECT_CATEGORY_LABEL]} · <Badge>{PROJECT_STATUS_LABEL[p.status]}</Badge>
            {p.quarter ? ` · ${p.quarter}분기` : ""}
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <ProjectFormDialog
              trigger={<Button variant="secondary" size="sm">정보 수정</Button>}
              initial={{
                id: p.id, title: p.title, category: p.category, event_start: s(p.event_start), event_end: s(p.event_end), venue: p.venue ?? "",
                expected_beneficiaries: p.expected_beneficiaries?.toString() ?? "", host: p.host ?? "", organizer: p.organizer ?? "",
                uses_external_vendor: p.uses_external_vendor, school: fund("school"), student_fee: fund("student_fee"),
              }}
            />
            <ProjectActions id={p.id} status={p.status} />
          </div>
        ) : null}
      </div>

      {p.status === "cancelled" ? (
        <p className="rounded-lg border border-border bg-bg px-3 py-2 text-sm" role="status">취소된 사업입니다. 미완료 업무는 취소되었고 완료 업무·증빙·기록은 보존됩니다.</p>
      ) : null}

      <Card>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          <div><dt className="text-muted">행사일</dt><dd className="tabular">{p.event_start ? `${formatKoreanDate(s(p.event_start))}${p.event_end && s(p.event_end) !== s(p.event_start) ? ` ~ ${formatKoreanDate(s(p.event_end))}` : ""}` : "-"}</dd></div>
          <div><dt className="text-muted">장소</dt><dd>{p.venue ?? "-"}</dd></div>
          <div><dt className="text-muted">재원</dt><dd>{p.funding_sources.length ? p.funding_sources.map((f) => `${FUNDING_LABEL[f.source]} ${Number(f.amount_planned).toLocaleString()}원`).join(", ") : "미정"}</dd></div>
          <div><dt className="text-muted">수혜 인원</dt><dd className="tabular">{p.expected_beneficiaries ?? "-"}{p.expected_beneficiaries !== null ? "명" : ""}</dd></div>
          <div><dt className="text-muted">주최</dt><dd>{p.host ?? "-"}</dd></div>
          <div><dt className="text-muted">주관</dt><dd>{p.organizer ?? "-"}</dd></div>
          <div><dt className="text-muted">외부업체</dt><dd>{p.uses_external_vendor ? "이용" : "없음"}</dd></div>
        </dl>
      </Card>

      <Card>
        <CardTitle className="mb-3">사업 진척도</CardTitle>
        <ProjectProgressBar progress={progress.get(id)!} projectId={id} />
      </Card>

      <section aria-label="국서별 업무 보드">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">국서별 업무</h2>
          {can(user, { type: "task.create" }) && p.status !== "cancelled" ? (
            <TaskFormDialog defaultProjectId={id} trigger={<Button size="sm"><Plus className="h-4 w-4" /> 업무 추가</Button>} />
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          {DEPARTMENT_CODES.map((code) => {
            const t = DEPARTMENTS[code];
            const mine = rows.filter((r) => r.departments.some((d) => d.code === code));
            return (
              <div key={code} className="rounded-xl border border-border bg-surface" data-board-dept={code}>
                <div className="rounded-t-xl px-3 py-2 text-sm font-semibold" style={{ backgroundColor: t.chipBg, color: t.ink }}>
                  <Link href={`/departments/${code}?project=${id}`} className="hover:underline">{t.nameKo}</Link> <span className="font-normal">({mine.length})</span>
                </div>
                <ul className="space-y-1 p-2">
                  {mine.length === 0 ? <li className="px-1 py-2 text-xs text-muted">업무 없음</li> : null}
                  {mine.map((r) => (
                    <li key={r.id} className="rounded-lg border border-border px-2 py-1.5 text-xs">
                      <Link href={`?task=${r.id}`} scroll={false} className={cn("block font-medium hover:underline", (r.isCompleted || r.status === "cancelled") && "text-muted line-through")}>{r.title}</Link>
                      <span className="text-muted">
                        {r.departments.find((d) => d.code === code)?.role === "support" ? "협조 · " : ""}
                        {r.due ?? "마감 없음"} · {r.effective}%{r.status === "blocked" ? " · 차단" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle className="mb-2">선후 관계</CardTitle>
          {deps.length === 0 ? (
            <p className="text-sm text-muted">연결된 선후 관계가 없습니다.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {deps.map((d) => <li key={d.id}>{d.depends_on.title} <span className="text-muted">→</span> {d.task.title}</li>)}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle className="mb-2">이력</CardTitle>
          <ul className="space-y-1 text-sm">
            {logs.map((l) => (
              <li key={l.id} className="flex gap-3">
                <time className="tabular w-28 shrink-0 text-xs text-muted">{l.created_at.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                <span>{ACTION[l.action] ?? l.action}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <ComingSoon phase={7} label="기획안" />
        <ComingSoon phase={9} label="재정(예산·구입·증빙)" />
        <ComingSoon phase={9} label="제휴 진행표" />
      </div>
    </div>
  );
}
