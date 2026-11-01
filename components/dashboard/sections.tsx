import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { DemoBadge, Badge } from "@/components/common/badges";
import { ComingSoon, EmptyState } from "@/components/common/empty-state";
import { UpcomingList, type UpcomingItem } from "./upcoming-list";
import { QuarterCalendar } from "@/components/calendar/quarter-calendar";
import { ProjectProgressBar } from "@/components/projects/project-progress-bar";
import type { ProjectProgress } from "@kgb/rules";
import { ProgressBar } from "@/components/dept/progress-bar";
import { DEPARTMENTS, type DepartmentCode } from "@/lib/design/tokens";
import type { DeptCard } from "@/lib/dashboard";
import { dDayLabel, formatKoreanDate } from "@/lib/utils";

import { MEETING_STATUS_LABEL as MEETING_STATUS } from "@/lib/services/meetings";

export function Banner({ title, subtitle, councilName, imageUrl, editor }: { title: string; subtitle: string | null; councilName: string; imageUrl: string | null; editor: React.ReactNode }) {
  return (
    <section
      aria-label="학생회 배너"
      className="relative flex h-[280px] items-end overflow-hidden rounded-xl bg-cover bg-center p-8 text-white"
      style={{ backgroundImage: imageUrl ? `url("${imageUrl}")` : "linear-gradient(135deg, #276C91 0%, #3B5B7A 55%, #7F0810 100%)" }}
      data-has-image={imageUrl ? "true" : "false"}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-transparent" aria-hidden />
      <div className="relative">
        <p className="text-sm font-medium opacity-90">{councilName}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight md:text-[40px] md:leading-tight">{title}</h1>
        {subtitle ? <p className="mt-2 text-base opacity-90">{subtitle}</p> : null}
      </div>
      {editor ? <div className="absolute top-4 right-4">{editor}</div> : null}
    </section>
  );
}

export function RecentMeetings({ meetings }: { meetings: { id: string; title: string; meeting_date: Date; status: string; is_demo: boolean }[] }) {
  return (
    <Card className="flex flex-col">
      <div className="mb-3 flex items-center justify-between">
        <CardTitle>최근 회의록</CardTitle>
      </div>
      {meetings.length === 0 ? (
        <EmptyState
          title="아직 회의록이 없습니다"
          description="상단의 '회의록 업로드'로 올리면 글자를 추출해 회의록 공간에 저장합니다."
          action={<Link href="/minutes" className="text-sm underline">회의록 공간으로</Link>}
        />
      ) : (
        <ul className="divide-y divide-border">
          {meetings.map((m) => (
            <li key={m.id}>
              <Link href={`?meeting=${m.id}`} scroll={false} className="flex items-center justify-between gap-2 py-2.5 hover:bg-bg">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{m.title}</span>
                  <span className="tabular text-xs text-muted">{formatKoreanDate(m.meeting_date.toISOString().slice(0, 10))}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {m.is_demo ? <DemoBadge /> : null}
                  <Badge>{MEETING_STATUS[m.status] ?? m.status}</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href="/minutes" className="mt-3 block text-right text-xs text-muted hover:text-text hover:underline">전체 회의록 보기 →</Link>
    </Card>
  );
}

export function QuarterCalendarCard({ quarters, current, today }: { quarters: Record<string, string>; current: 1 | 2 | 3 | 4; today: string }) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <CardTitle>분기 캘린더</CardTitle>
        <span className="flex items-center gap-2 text-xs text-muted">
          <span className="rounded border border-dashed border-muted px-1">제안</span>
          <span className="rounded border border-muted px-1">확정</span>
          <span>오늘 기준 {current}분기</span>
        </span>
      </div>
      <QuarterCalendar quarters={quarters} initialQuarter={current} today={today} />
    </Card>
  );
}

export function Upcoming30({ items, today, canEdit }: { items: UpcomingItem[]; today: string; canEdit: boolean }) {
  return (
    <Card>
      <CardTitle className="mb-3">향후 30일 일정</CardTitle>
      {items.length === 0 ? <EmptyState title="30일 안에 마감되는 업무가 없습니다" /> : <UpcomingList items={items} today={today} canEdit={canEdit} />}
    </Card>
  );
}

export function NearestProject({
  project,
  progress,
  today,
}: {
  project: { id: string; title: string; event_start: Date | null; funding: string[] } | null;
  progress: ProjectProgress | null;
  today: string;
}) {
  return (
    <Card>
      <CardTitle className="mb-3">가장 가까운 사업 진척도</CardTitle>
      {!project || !progress ? (
        <EmptyState
          title="예정된 사업이 없습니다"
          description="회의록을 올리거나 사업을 직접 만들면 여기에 진척도가 표시됩니다."
          action={<Link href="/projects" className="text-sm underline">사업 공간으로</Link>}
        />
      ) : (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Link href={`/projects/${project.id}`} className="text-base font-semibold hover:underline">{project.title}</Link>
            {project.event_start ? (
              <span className="tabular text-muted">
                {formatKoreanDate(project.event_start.toISOString().slice(0, 10))} · {dDayLabel(project.event_start.toISOString().slice(0, 10), today)}
              </span>
            ) : null}
            {project.funding.map((f) => <Badge key={f}>{f}</Badge>)}
          </p>
          <ProjectProgressBar progress={progress} projectId={project.id} />
        </div>
      )}
    </Card>
  );
}

export function DepartmentCards({ cards, today }: { cards: DeptCard[]; today: string }) {
  return (
    <section aria-label="국서 현황" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((c) => {
        const t = DEPARTMENTS[c.code];
        return (
          <article key={c.code} className="relative overflow-hidden rounded-xl border border-border bg-surface hover:border-[#C9C6C0]" data-dept={c.code}>
            <div className="h-1.5" style={{ backgroundColor: t.base, boxShadow: t.fillBorder ? `inset 0 -1px 0 ${t.fillBorder}` : undefined }} />
            <div className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold" style={{ color: t.ink }}>
                  <Link href={`/departments/${c.code}`} className="hover:underline">{c.name}</Link>
                </h3>
                <span className="tabular text-sm font-semibold">{Math.round(c.progress)}%</span>
              </div>
              <ProgressBar code={c.code} value={c.progress} showValue={false} />
              <div className="mt-3 min-h-20">
                {c.urgent.length === 0 ? (
                  <p className="text-xs text-muted">급한 업무가 없습니다.</p>
                ) : (
                  <ul className="space-y-2">
                    {c.urgent.map((u) => (
                      <li key={u.id}>
                        <Link href={`?task=${u.id}`} scroll={false} className="block text-xs hover:underline">
                          <span className="flex justify-between gap-2">
                            <span className="truncate">{u.title}</span>
                            <span className="tabular shrink-0 text-muted">{u.due ? dDayLabel(u.due, today) : ""}</span>
                          </span>
                        </Link>
                        <ProgressBar code={c.code} value={u.progress} showValue={false} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-1 border-t border-border pt-3 text-center text-xs">
                <div><dt className="text-muted">진행 중</dt><dd className="tabular font-semibold">{c.inProgress}</dd></div>
                <div><dt className="text-muted">지연</dt><dd className={`tabular font-semibold ${c.overdue ? "text-danger" : ""}`}>{c.overdue}</dd></div>
                <div><dt className="text-muted">검토 대기</dt><dd className="tabular font-semibold">{c.review}</dd></div>
              </dl>
            </div>
          </article>
        );
      })}
    </section>
  );
}
