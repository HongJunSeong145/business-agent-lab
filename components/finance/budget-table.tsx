"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";

type Line = { id: string; project: { id: string; title: string } | null; funding_source: string | null; category: string | null; item: string; planned: number; actual: number | null; tax: number };
type Q = {
  period: { quarter: number; reviewLabel: string; budgetStatus: string; settlementStatus: string };
  lines: Line[];
  totals: { planned: number; tax: number; plannedWithTax: number; actual: number };
  projects: { id: string; title: string }[];
  canEdit: boolean;
};
const won = (n: number) => n.toLocaleString();
const SRC: Record<string, string> = { school: "교비", student_fee: "학생회비" };
const PSTAT: Record<string, string> = { draft: "작성 중", submitted: "제출", approved: "승인" };

/** 분기 예결산 표 (8-8): 사업별 라인, 재원, 계획·실제, 교비 세금 포함 총액 */
export function BudgetTable({ q }: { q: Q }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok);
      router.refresh();
      return true;
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const quarter = q.period.quarter;
  return (
    <div className="space-y-3" data-testid="budget-table">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {(["budget", "settlement"] as const).map((kind) => (
          <label key={kind} className="flex items-center gap-1.5">
            {kind === "budget" ? "예산안" : "결산안"}
            {q.canEdit ? (
              <Select aria-label={kind === "budget" ? "예산안 상태" : "결산안 상태"} className="h-8 w-28" value={kind === "budget" ? q.period.budgetStatus : q.period.settlementStatus} onChange={(e) => void run(() => api(`/api/finance/${quarter}`, { method: "PATCH", body: { kind, status: e.target.value } }), "상태를 바꿨습니다.")}>
                {Object.entries(PSTAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            ) : <strong>{PSTAT[kind === "budget" ? q.period.budgetStatus : q.period.settlementStatus]}</strong>}
          </label>
        ))}
        <a className="ml-auto text-sm underline" href={`/api/finance/export?quarter=${quarter}`}>CSV 내보내기</a>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm" aria-label={`${quarter}분기 예결산`}>
          <thead className="border-b border-border text-xs text-muted">
            <tr><th className="py-2">사업</th><th>재원</th><th>분류</th><th>항목</th><th className="text-right">계획액</th><th className="text-right">세금(교비)</th><th className="text-right">계획 총액</th><th className="text-right">실제 집행액</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {q.lines.length === 0 ? <tr><td colSpan={9} className="py-3 text-muted">아직 예산 라인이 없습니다.</td></tr> : null}
            {q.lines.map((l) => (
              <tr key={l.id} data-line={l.item}>
                <td className="py-1.5">{l.project?.title ?? "공통"}</td>
                <td>{l.funding_source ? SRC[l.funding_source] : "-"}</td>
                <td>{l.category ?? ""}</td>
                <td>{l.item}</td>
                <td className="tabular text-right">{won(l.planned)}</td>
                <td className="tabular text-right">{l.tax ? won(l.tax) : "-"}</td>
                <td className="tabular text-right font-medium">{won(l.planned + l.tax)}</td>
                <td className="tabular text-right">
                  {q.canEdit ? (
                    <input
                      aria-label={`${l.item} 실제 집행액`}
                      type="number"
                      min={0}
                      defaultValue={l.actual ?? ""}
                      key={`${l.id}-${l.actual}`}
                      className="w-28 rounded border border-transparent bg-transparent px-1 text-right hover:border-border"
                      onBlur={(e) => {
                        const v = e.target.value === "" ? null : Number(e.target.value);
                        if (v !== l.actual) void run(() => api(`/api/finance/lines/${l.id}`, { method: "PATCH", body: { actual_amount: v } }), "저장했습니다.");
                      }}
                    />
                  ) : l.actual === null ? "-" : won(l.actual)}
                </td>
                <td>{q.canEdit ? <button aria-label={`${l.item} 삭제`} className="text-muted hover:text-danger" onClick={() => window.confirm("이 라인을 삭제할까요?") && void run(() => api(`/api/finance/lines/${l.id}`, { method: "DELETE" }), "삭제했습니다.")}><Trash2 className="h-4 w-4" /></button> : null}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-border font-semibold">
            <tr data-testid="budget-totals"><td colSpan={4} className="py-2">합계</td><td className="tabular text-right">{won(q.totals.planned)}</td><td className="tabular text-right">{won(q.totals.tax)}</td><td className="tabular text-right">{won(q.totals.plannedWithTax)}</td><td className="tabular text-right">{won(q.totals.actual)}</td><td /></tr>
          </tfoot>
        </table>
      </div>
      {q.canEdit ? (
        <form
          aria-label="예산 라인 추가"
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const fd = Object.fromEntries(new FormData(f)) as Record<string, string>;
            const ok = await run(() => api(`/api/finance/${quarter}`, { body: { ...fd, project_id: fd.project_id || null, funding_source: fd.funding_source || null, category: fd.category || null } }), "예산 라인을 추가했습니다.");
            if (ok) f.reset();
          }}
        >
          <Select name="project_id" aria-label="라인 사업" className="h-8 w-44"><option value="">공통(사업 없음)</option>{q.projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select>
          <Select name="funding_source" aria-label="라인 재원" className="h-8 w-28"><option value="">재원</option><option value="school">교비</option><option value="student_fee">학생회비</option></Select>
          <Input name="category" placeholder="분류" aria-label="라인 분류" className="h-8 w-24" />
          <Input name="item" required placeholder="항목" aria-label="라인 항목" className="h-8 w-36" />
          <Input name="planned_amount" type="number" min={0} required placeholder="계획액" aria-label="라인 계획액" className="h-8 w-32" />
          <Button size="sm" variant="secondary" disabled={busy}>추가</Button>
        </form>
      ) : null}
    </div>
  );
}

/** '지금 점검' (A7 수동 실행) */
export function RunMonitorButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api<{ alerts: number; created: number }>("/api/monitor/run", { method: "POST" });
          toast(`점검 완료: 발견 ${r.alerts}건, 새 알림 ${r.created}건`);
          router.refresh();
        } catch (e) {
          toast((e as Error).message, { tone: "error" });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "점검 중…" : "지금 점검"}
    </Button>
  );
}
