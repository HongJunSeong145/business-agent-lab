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
import { PartnersPanel, ProjectFinancePanel } from "@/components/finance/project-finance";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { ProjectActions, ProjectDeleteButton } from "@/components/projects/project-actions";
import { BoardTaskDelete } from "@/components/tasks/board-task-delete";
import { TrashPanel } from "@/components/tasks/trash-panel";
import { ProjectProgressBar } from "@/components/projects/project-progress-bar";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { SchedulePanel } from "@/components/projects/schedule-panel";
import { PlanPanel } from "@/components/projects/plan-panel";
import { EventDateSetter } from "@/components/projects/event-date-setter";
import { ArchivePanel } from "@/components/projects/archive-panel";
import { getProjectSchedule } from "@/lib/services/schedule";
import { loadRuleParams } from "@/lib/rule-params";
import { PROMO_TIER_LABEL, withTax, type PromoTier } from "@kgb/rules";

const EVIDENCE_LABEL: Record<string, string> = {
  receipt: "영수증·이체내역", photo: "행사 사진", beneficiary_roster: "수혜자 명단", official_letter: "공문", plan_doc: "기획안", quote: "견적서", transfer_record: "이체내역", other: "기타",
};

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
  const [rows, progress, logs, deps, schedule, evidence, ruleParams] = await Promise.all([
    loadTaskRows(user, { project_id: id }),
    loadProjectProgress([id]),
    prisma.activityLog.findMany({ where: { entity_type: "project", entity_id: id }, orderBy: { created_at: "desc" }, take: 30 }),
    prisma.taskDependency.findMany({
      where: { task: { project_id: id, deleted_at: null }, depends_on: { deleted_at: null } },
      include: { task: { select: { title: true } }, depends_on: { select: { title: true } } },
    }),
    getProjectSchedule(prisma, user, id),
    prisma.evidenceRequirement.findMany({ where: { project_id: id }, include: { _count: { select: { items: true } } }, orderBy: { created_at: "asc" } }),
    loadRuleParams(prisma, user.termId),
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
                uses_external_vendor: p.uses_external_vendor, school: fund("school"), student_fee: fund("student_fee"), promo_tier: p.promo_tier ?? "",
              }}
            />
            <ProjectActions id={p.id} status={p.status} />
            {can(user, { type: "project.cancel" }) ? <ProjectDeleteButton id={p.id} title={p.title} /> : null}
          </div>
        ) : can(user, { type: "project.cancel" }) ? (
          <ProjectDeleteButton id={p.id} title={p.title} />
        ) : null}
      </div>

      {!p.event_start && p.status !== "cancelled" ? <EventDateSetter projectId={p.id} canEdit={canEdit} /> : null}

      {p.status === "cancelled" ? (
        <p className="rounded-lg border border-border bg-bg px-3 py-2 text-sm" role="status">취소된 사업입니다. 미완료 업무는 취소되었고 완료 업무·증빙·기록은 보존됩니다.</p>
      ) : null}

      <Card>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          <div><dt className="text-muted">행사일</dt><dd className="tabular">{p.event_start ? `${formatKoreanDate(s(p.event_start))}${p.event_end && s(p.event_end) !== s(p.event_start) ? ` ~ ${formatKoreanDate(s(p.event_end))}` : ""}` : "-"}</dd></div>
          <div><dt className="text-muted">장소</dt><dd>{p.venue ?? "-"}</dd></div>
          <div className="col-span-2">
            <dt className="text-muted">재원</dt>
            <dd data-testid="funding">
              {p.funding_sources.length === 0 ? "미정" : null}
              {p.funding_sources.map((f) => {
                const amt = Number(f.amount_planned);
                if (f.source !== "school") return <span key={f.source} className="mr-3 inline-block">학생회비 {amt.toLocaleString()}원</span>;
                const t = withTax(amt, ruleParams.SCHOOL_TAX_RATE);
                return (
                  <span key={f.source} className="mr-3 inline-block">
                    교비 {t.amount.toLocaleString()}원 + 세금 {Math.round(ruleParams.SCHOOL_TAX_RATE * 100)}% {t.tax.toLocaleString()}원 = <strong>세금 포함 {t.total.toLocaleString()}원</strong>
                  </span>
                );
              })}
            </dd>
          </div>
          <div><dt className="text-muted">홍보 등급</dt><dd>{p.promo_tier ? PROMO_TIER_LABEL[p.promo_tier as PromoTier] : "미정(저비용으로 계산)"}</dd></div>
          <div><dt className="text-muted">수혜 인원</dt><dd className="tabular">{p.expected_beneficiaries ?? "-"}{p.expected_beneficiaries !== null ? "명" : ""}</dd></div>
          <div><dt className="text-muted">주최</dt><dd>{p.host ?? "-"}</dd></div>
          <div><dt className="text-muted">주관</dt><dd>{p.organizer ?? "-"}</dd></div>
          <div><dt className="text-muted">외부업체</dt><dd>{p.uses_external_vendor ? "이용" : "없음"}</dd></div>
        </dl>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardTitle className="mb-3">일정·규칙</CardTitle>
          <SchedulePanel projectId={id} view={schedule} canEdit={can(user, { type: "task.create" }) && p.status !== "cancelled"} />
        </Card>
        <Card>
          <CardTitle className="mb-2">증빙 요구사항</CardTitle>
          {evidence.length === 0 ? (
            <p className="text-sm text-muted">재원을 정하면 규칙에 따라 표시됩니다.</p>
          ) : (
            <ul className="space-y-1 text-sm" data-testid="evidence-requirements">
              {evidence.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2">
                  <span>{EVIDENCE_LABEL[e.type] ?? e.type}{e.type === "beneficiary_roster" ? ` (${e.required ? "필수" : "선택"})` : !e.required ? " (권장)" : ""}</span>
                  <span className="tabular text-xs text-muted">{e.due_date ? `~${dateColumnToString(e.due_date).slice(5)}` : ""} · 제출 {e._count.items}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card id="plan" className="scroll-mt-20">
        <CardTitle className="mb-3">기획안</CardTitle>
        <PlanPanel projectId={id} />
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
                  <Link href={`/departments/${code}?in_project=${id}`} className="hover:underline">{t.nameKo}</Link> <span className="font-normal">({mine.length})</span>
                </div>
                <ul className="space-y-1 p-2">
                  {mine.length === 0 ? <li className="px-1 py-2 text-xs text-muted">업무 없음</li> : null}
                  {mine.map((r) => (
                    <li key={r.id} className="group relative rounded-lg border border-border px-2 py-1.5 text-xs">
                      {can(user, { type: "task.create" }) ? <BoardTaskDelete id={r.id} title={r.title} /> : null}
                      <Link href={`?task=${r.id}`} scroll={false} className={cn("block pr-5 font-medium hover:underline", (r.isCompleted || r.status === "cancelled") && "text-muted line-through")}>{r.title}</Link>
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

      {can(user, { type: "task.create" }) ? <TrashPanel query={`project=${p.id}`} /> : null}

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

      <Card id="archive" className="scroll-mt-20">
        <CardTitle className="mb-1">작업물 보관함</CardTitle>
        <p className="mb-3 text-xs text-muted">
          {p.status === "done" ? "완료된 사업입니다. 국서별 최종 결과물이 보관되어 있습니다." : "재정국을 뺀 모든 업무가 100%가 되면 사업이 '완료'로 바뀌고, 이곳에 국서별 결과물이 보관됩니다."}
        </p>
        <ArchivePanel projectId={id} />
      </Card>

      <Card id="finance" className="scroll-mt-20">
        <CardTitle className="mb-3">재정 — 구입·증빙</CardTitle>
        <ProjectFinancePanel projectId={id} />
      </Card>

      <Card id="partners" className="scroll-mt-20">
        <CardTitle className="mb-3">제휴 진행표</CardTitle>
        <PartnersPanel projectId={id} />
      </Card>
    </div>
  );
}
