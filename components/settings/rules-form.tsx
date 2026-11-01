"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { TEMPLATES, type RuleParams, type TemplateKey } from "@kgb/rules";

type Holiday = { date: string; name: string };

const NUMBERS: [keyof RuleParams, string, string][] = [
  ["SCHOOL_SUBMIT_LEAD_DAYS", "교비 행정실 송부 (행사 며칠 전)", "일"],
  ["VENDOR_CONFIRM_BUFFER_DAYS", "외부업체 확정 (송부 며칠 전)", "일"],
  ["SCHOOL_TAX_RATE", "교비 세금 비율", "(0.1 = 10%)"],
  ["ROSTER_THRESHOLD", "수혜자 명단 필수 기준 (이하이면 필수)", "명"],
  ["PROMO_HIGH_COST_AMOUNT", "홍보물 고비용 기준 금액", "원"],
  ["PROMO_HIGH_QTY", "홍보물 고비용 기준 수량", "개"],
  ["PROMO_PUBLISH_LATEST_DAYS", "홍보물 게시 (늦어도 행사 며칠 전)", "일"],
  ["OPS_MANUAL_LATEST_DAYS", "집행 매뉴얼 (늦어도 행사 며칠 전)", "일"],
  ["PURCHASE_LATEST_DAYS", "최종 구입 (늦어도 행사 며칠 전)", "일"],
  ["EVIDENCE_PHOTO_GRACE_DAYS", "사진·명단 수집 (행사 며칠 후까지)", "일"],
];

/** 규칙 엔진 파라미터·휴일 (5-7) — 바꾸면 진행 중 사업의 제안 마감을 다시 계산 */
export function RulesForm({ initial, holidays: initialHolidays }: { initial: RuleParams; holidays: Holiday[] }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [holidays, setHolidays] = useState(initialHolidays);
  const [newH, setNewH] = useState<Holiday>({ date: "", name: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2">
        {NUMBERS.map(([k, l, unit]) => (
          <div key={k}>
            <Label htmlFor={k}>{l} <span className="font-normal text-muted">{unit}</span></Label>
            <Input id={k} type="number" step="any" min={0} value={v[k] as number} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />
          </div>
        ))}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">표준 업무 기본 소요일</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(v.DEFAULT_DURATIONS).map(([k, d]) => (
            <label key={k} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{TEMPLATES[k as TemplateKey]?.title ?? k}</span>
              <Input aria-label={`${TEMPLATES[k as TemplateKey]?.title ?? k} 소요일`} type="number" min={1} max={120} className="w-20" value={d} onChange={(e) => setV({ ...v, DEFAULT_DURATIONS: { ...v.DEFAULT_DURATIONS, [k]: Number(e.target.value) } })} />
            </label>
          ))}
        </div>
        <h3 className="mt-4 mb-2 text-sm font-semibold">홍보물 제작 소요일(등급별)</h3>
        <div className="flex flex-wrap gap-4">
          {([["free", "무비용"], ["low", "저비용"], ["high", "고비용"]] as const).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              {l}
              <Input aria-label={`${l} 제작 소요일`} type="number" min={1} max={120} className="w-20" value={v.PROMO_DURATIONS[k]} onChange={(e) => setV({ ...v, PROMO_DURATIONS: { ...v.PROMO_DURATIONS, [k]: Number(e.target.value) } })} />
            </label>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold">휴일 ({holidays.length})</h3>
        <p className="mb-2 text-xs text-muted">마감이 휴일·주말이면 직전 평일로 당깁니다. 공휴일 목록은 미리 넣어 두었으니 맞는지 확인하고, 학사 휴일(개교기념일 등)을 추가하세요.</p>
        <ul className="mb-2 grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2" aria-label="휴일 목록">
          {holidays.map((h) => (
            <li key={h.date} className="flex items-center justify-between gap-2 rounded bg-bg px-2 py-1 text-sm">
              <span className="tabular">{h.date}</span>
              <span className="flex-1 truncate text-muted">{h.name}</span>
              <button aria-label={`${h.date} 휴일 삭제`} onClick={() => setHolidays(holidays.filter((x) => x.date !== h.date))}><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Input type="date" aria-label="휴일 날짜" className="w-44" value={newH.date} onChange={(e) => setNewH({ ...newH, date: e.target.value })} />
          <Input aria-label="휴일 이름" className="w-48" placeholder="예) 개교기념일" value={newH.name} onChange={(e) => setNewH({ ...newH, name: e.target.value })} />
          <Button
            variant="secondary"
            disabled={!newH.date}
            onClick={() => {
              setHolidays([...holidays.filter((h) => h.date !== newH.date), { date: newH.date, name: newH.name || "휴일" }].sort((a, b) => a.date.localeCompare(b.date)));
              setNewH({ date: "", name: "" });
            }}
          >
            <Plus className="h-4 w-4" /> 휴일 추가
          </Button>
        </div>
      </section>

      <FormMessage>{error}</FormMessage>
      <Button
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const { HOLIDAYS: _ignored, ...rest } = v;
            void _ignored;
            const r = await api<{ projectsRecalculated: number }>("/api/settings/rules", { method: "PUT", body: { ...rest, HOLIDAYS: holidays } });
            toast(`규칙 설정을 저장했습니다. 진행 중 사업 ${r.projectsRecalculated}건의 제안 마감을 다시 계산했습니다.`);
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "저장 중…" : "저장"}
      </Button>
    </div>
  );
}
