import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/can";
import { getQuarter } from "@/lib/services/finance";
import { collectMonitorInput, lastMonitorRun } from "@/lib/services/monitor";
import { todayKst } from "@/lib/clock";
import { dateColumnToString, cn } from "@/lib/utils";
import { defaultQuarter, detectAlerts } from "@kgb/rules";
import { Card, CardTitle } from "@/components/ui/card";
import { BudgetTable, RunMonitorButton } from "@/components/finance/budget-table";

export const dynamic = "force-dynamic";

/** 재정 페이지 (8-8): 분기 탭(심사 묶음 1·2 / 3·4) + 예결산 표 + 증빙 현황 보드 + 모니터링 */
export default async function FinancePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const term = await prisma.term.findUniqueOrThrow({ where: { id: user.termId } });
  const tq = {
    q1_start: dateColumnToString(term.q1_start), q1_end: dateColumnToString(term.q1_end), q2_start: dateColumnToString(term.q2_start), q2_end: dateColumnToString(term.q2_end),
    q3_start: dateColumnToString(term.q3_start), q3_end: dateColumnToString(term.q3_end), q4_start: dateColumnToString(term.q4_start), q4_end: dateColumnToString(term.q4_end),
  };
  const sp = await searchParams;
  const quarter = [1, 2, 3, 4].includes(Number(sp.q)) ? Number(sp.q) : defaultQuarter(tq, todayKst());
  const [q, input, last] = await Promise.all([getQuarter(prisma, user, quarter), collectMonitorInput(prisma, user.termId), lastMonitorRun(prisma, user.termId)]);
  const alerts = detectAlerts({ today: todayKst(), tasks: input.tasks, projects: input.projects, stallDays: 3, photoGraceDays: input.params.EVIDENCE_PHOTO_GRACE_DAYS });
  const evidenceAlerts = alerts.filter((a) => ["receipt_missing", "photo_missing", "roster_missing"].includes(a.kind));
  const board = input.raw.projects
    .filter((p) => p.status !== "cancelled" && p.evidence_requirements.length)
    .map((p) => ({ id: p.id, title: p.title, reqs: p.evidence_requirements.map((r) => ({ type: r.type, required: r.required, met: r._count.items > 0 })), missing: evidenceAlerts.filter((a) => a.project_id === p.id) }));
  const LABEL: Record<string, string> = { receipt: "영수증", photo: "사진", beneficiary_roster: "명단", official_letter: "공문", plan_doc: "기획안", quote: "견적서", transfer_record: "이체내역", other: "기타" };
  const lastSummary = (last?.diff ?? null) as { alerts?: number; created?: number; summary?: Record<string, number> } | null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">재정</h1>
      <nav aria-label="분기" className="flex flex-wrap items-center gap-1">
        {[1, 2, 3, 4].map((n) => (
          <Link key={n} href={`/finance?q=${n}`} aria-current={n === quarter ? "page" : undefined} className={cn("rounded-lg border px-3 py-1.5 text-sm", n === quarter ? "border-text font-semibold" : "border-border text-muted")}>
            {n}분기
          </Link>
        ))}
        <span className="ml-2 text-xs text-muted">심사 묶음: 1·2분기 함께 / 3·4분기 함께 — 지금 {q.period.reviewLabel}</span>
      </nav>

      <Card>
        <CardTitle className="mb-3">{quarter}분기 예산안·결산안</CardTitle>
        <BudgetTable q={JSON.parse(JSON.stringify(q))} />
      </Card>

      <Card>
        <CardTitle className="mb-3">증빙 현황</CardTitle>
        {board.length === 0 ? <p className="text-sm text-muted">재원이 정해진 사업이 없습니다.</p> : null}
        <ul className="space-y-2" data-testid="evidence-board">
          {board.map((b) => (
            <li key={b.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/projects/${b.id}#finance`} className="font-medium underline">{b.title}</Link>
                {b.reqs.map((r, i) => (
                  <span key={i} className={cn("rounded border px-1.5 py-0.5 text-xs", r.met ? "border-success text-success" : r.required ? "border-warning text-warning-text" : "border-border text-muted")}>
                    {LABEL[r.type] ?? r.type} {r.met ? "충족" : "누락"}
                  </span>
                ))}
              </div>
              {b.missing.length ? <ul className="mt-1 list-disc pl-5 text-xs text-warning-text">{b.missing.map((m) => <li key={m.entity}>{m.title}</li>)}</ul> : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card id="monitor" className="scroll-mt-20">
        <div className="mb-2 flex items-center justify-between">
          <CardTitle>사업 진행 모니터링(매일 09:00 자동)</CardTitle>
          {can(user, { type: "monitor.run" }) ? <RunMonitorButton /> : null}
        </div>
        <p className="text-sm" data-testid="monitor-last">
          {last ? `최근 점검 ${last.created_at.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} — 발견 ${lastSummary?.alerts ?? 0}건, 새 알림 ${lastSummary?.created ?? 0}건` : "아직 점검 기록이 없습니다."}
        </p>
        <p className="text-sm text-muted">지금 기준: 마감 초과 {alerts.filter((a) => a.kind === "overdue").length} · 임박 {alerts.filter((a) => a.kind === "deadline").length} · 진척 없음/차단 {alerts.filter((a) => a.kind === "stall" || a.kind === "blocked_long").length} · 증빙 누락 {evidenceAlerts.length}</p>
      </Card>
    </div>
  );
}
