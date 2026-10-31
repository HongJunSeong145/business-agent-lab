import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { DemoBadge, Badge } from "@/components/common/badges";
import { ComingSoon, EmptyState } from "@/components/common/empty-state";
import { DeptChip } from "@/components/dept/dept-chip";
import { ProgressBar } from "@/components/dept/progress-bar";
import { DEPARTMENTS, type DepartmentCode } from "@/lib/design/tokens";
import type { DeptCard } from "@/lib/dashboard";
import { dDayLabel, formatKoreanDate } from "@/lib/utils";

import { MEETING_STATUS_LABEL as MEETING_STATUS } from "@/lib/services/meetings";

export function Banner({ title, subtitle, councilName, canEdit }: { title: string; subtitle: string | null; councilName: string; canEdit: boolean }) {
  return (
    <section
      aria-label="학생회 배너"
      className="relative flex h-[280px] items-end overflow-hidden rounded-xl p-8 text-white"
      style={{ background: "linear-gradient(135deg, #276C91 0%, #3B5B7A 55%, #7F0810 100%)" }}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-transparent" aria-hidden />
      <div className="relative">
        <p className="text-sm font-medium opacity-90">{councilName}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight md:text-[40px] md:leading-tight">{title}</h1>
        {subtitle ? <p className="mt-2 text-base opacity-90">{subtitle}</p> : null}
      </div>
      {canEdit ? (
        <div className="absolute top-4 right-4">
          <span className="inline-flex h-8 cursor-not-allowed items-center rounded-lg bg-black/30 px-3 text-xs" title="배너 편집은 Phase 8에서 제공됩니다" aria-disabled="true">
            배너 편집 · Phase 8 예정
          </span>
        </div>
      ) : null}
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

export function QuarterCalendarShell({
  quarters,
  current,
}: {
  quarters: Record<string, string>;
  current: 1 | 2 | 3 | 4;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <CardTitle>분기 캘린더</CardTitle>
        <span className="text-xs text-muted">오늘 기준 {current}분기</span>
      </div>
      <div role="tablist" aria-label="분기 선택" className="mb-4 grid grid-cols-4 gap-1 rounded-lg bg-bg p-1">
        {([1, 2, 3, 4] as const).map((q) => (
          <div
            key={q}
            role="tab"
            aria-selected={q === current}
            className={`rounded-md px-2 py-1.5 text-center text-sm ${q === current ? "bg-surface font-semibold shadow-sm" : "text-muted"}`}
          >
            <span className="block">{q}분기</span>
            <span className="tabular block text-[11px] text-muted">
              {quarters[`q${q}_start`]?.slice(5).replace("-", ".")}~{quarters[`q${q}_end`]?.slice(5).replace("-", ".")}
            </span>
          </div>
        ))}
      </div>
      <EmptyState title="월 그리드 캘린더는 Phase 4에서 제공됩니다" description="분기 날짜는 기수 설정값을 사용합니다(설정 화면에서 수정 — Phase 4)." />
    </Card>
  );
}

export function Upcoming30({
  items,
  today,
}: {
  items: { id: string; title: string; due: string; dueState: string; leadCode: DepartmentCode | null; assignees: string[] }[];
  today: string;
}) {
  return (
    <Card>
      <CardTitle className="mb-3">향후 30일 일정</CardTitle>
      {items.length === 0 ? (
        <EmptyState title="30일 안에 마감되는 업무가 없습니다" />
      ) : (
        <ul className="space-y-2">
          {items.map((t) => (
            <li key={t.id}>
              <Link
                href={`?task=${t.id}`}
                scroll={false}
                className={`flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-bg ${t.dueState === "proposed" ? "border border-dashed border-border" : "border border-transparent"}`}
              >
                {t.leadCode ? <DeptChip code={t.leadCode} /> : null}
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="tabular text-xs text-muted">{dDayLabel(t.due, today)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function NearestProject({ project }: { project: { id: string; title: string; event_start: Date | null } | null }) {
  return (
    <Card>
      <CardTitle className="mb-3">가장 가까운 사업 진척도</CardTitle>
      {!project ? (
        <EmptyState title="예정된 사업이 없습니다" description="회의록을 올리거나 사업을 직접 만들면 여기에 진척도가 표시됩니다." action={<ComingSoon phase={3} label="사업 만들기" />} />
      ) : (
        <p className="text-sm">
          <Link href={`?project=${project.id}`} scroll={false} className="font-medium underline">{project.title}</Link> — 국서별 구간 막대는 Phase 8에서 완성됩니다.
        </p>
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
          <article key={c.code} className="overflow-hidden rounded-xl border border-border bg-surface" data-dept={c.code}>
            <div className="h-1.5" style={{ backgroundColor: t.base, boxShadow: t.fillBorder ? `inset 0 -1px 0 ${t.fillBorder}` : undefined }} />
            <div className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold" style={{ color: t.ink }}>{c.name}</h3>
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

type Profile = { id: string; position_title: string | null; name: string; major: string | null; student_id: string | null; phone: string | null; gmail: string | null; school_email: string | null; is_demo: boolean };

export function MemberDirectory({ profiles }: { profiles: Profile[] }) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <CardTitle>학생회 인적사항</CardTitle>
        <ComingSoon phase={8} label="편집" />
      </div>
      {profiles.length === 0 ? (
        <EmptyState title="등록된 인적사항이 없습니다" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>{["직책", "이름", "학과", "학번", "연락처", "G-mail", "학교메일"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td className="px-2 py-2">{p.position_title}{p.is_demo ? <DemoBadge className="ml-1" /> : null}</td>
                  <td className="px-2 py-2 font-medium">{p.name}</td>
                  <td className="px-2 py-2">{p.major}</td>
                  <td className="tabular px-2 py-2">{p.student_id}</td>
                  <td className="tabular px-2 py-2">{p.phone ? <a href={`tel:${p.phone}`} className="hover:underline">{p.phone}</a> : null}</td>
                  <td className="px-2 py-2">{p.gmail ? <a href={`mailto:${p.gmail}`} className="hover:underline">{p.gmail}</a> : null}</td>
                  <td className="px-2 py-2">{p.school_email ? <a href={`mailto:${p.school_email}`} className="hover:underline">{p.school_email}</a> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function ContactDirectory({
  columns,
  rows,
}: {
  columns: { key: string; label: string }[];
  rows: { id: string; data: unknown; is_demo: boolean }[];
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <CardTitle>외부 연락망</CardTitle>
        <ComingSoon phase={8} label="편집" />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="등록된 연락처가 없습니다" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>{columns.map((c) => <th key={c.key} className="px-2 py-2 font-medium">{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const data = (r.data ?? {}) as Record<string, string>;
                return (
                  <tr key={r.id}>
                    {columns.map((c, i) => (
                      <td key={c.key} className="px-2 py-2">
                        {data[c.key] ?? ""}
                        {i === 0 && r.is_demo ? <DemoBadge className="ml-1" /> : null}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
