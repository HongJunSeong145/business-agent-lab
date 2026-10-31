"use client";

import { Dialog } from "radix-ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import type { ProjectScheduleView } from "@/lib/services/schedule";
import { TEMPLATES, type TemplateKey } from "@kgb/rules";
import { cn } from "@/lib/utils";

const fmt = (s: string | null) => (s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : "—");

/** 사업 상세의 '일정·규칙' 영역 (PART 5 규칙 엔진 결과 표시 + 조작) */
export function SchedulePanel({ projectId, view, canEdit }: { projectId: string; view: ProjectScheduleView; canEdit: boolean }) {
  const router = useRouter();
  const [recalcOpen, setRecalcOpen] = useState(false);
  const r = view.result;

  if (!view.hasEventDate || !r) {
    return <p className="text-sm text-muted">행사일을 입력하면 규칙 엔진이 마감을 거꾸로 계산합니다.</p>;
  }
  const a = r.alternatives;
  const ms = r.milestones[0];

  return (
    <div className="space-y-3" data-testid="schedule-panel">
      {r.feasible ? (
        <p className="flex items-center gap-2 text-sm text-success" role="status"><CheckCircle2 className="h-4 w-4" /> 현재 일정으로 진행 가능합니다.</p>
      ) : (
        <div className="rounded-lg border border-danger/30 bg-[#FBEAEA] p-3 text-sm" role="alert" data-testid="infeasible">
          <p className="flex items-center gap-2 font-semibold text-danger"><AlertTriangle className="h-4 w-4" /> 일정 불가 — 일부 업무를 오늘 시작해도 기한을 넘깁니다.</p>
          <p className="mt-1 text-text">날짜를 자동으로 당기거나 압축하지 않았습니다. 아래 대안을 검토하세요.</p>
          {a ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-text" aria-label="대안">
              <li>(a) 소요일을 최소로 줄이면: {a.compress ? "가능" : "불가"}</li>
              {a.toStudentFee !== null ? <li>(b) 교비 → 학생회비로 바꾸면(행정실 21일 제약 없음): {a.toStudentFee ? "가능" : "불가"}</li> : null}
              <li>(c) 행사를 미루면 가능한 가장 빠른 날: {a.earliestEventDate ?? "1년 안에 없음"}</li>
              {a.withoutVendor !== null ? <li>(d) 외부업체 없이 진행하면: {a.withoutVendor ? "가능" : "불가"}</li> : null}
            </ul>
          ) : null}
        </div>
      )}
      {ms ? (
        <p className="text-sm">
          <span className="font-medium">행정실 송부 마감:</span> {ms.date ?? `${ms.latest} (이미 지남)`}{" "}
          <span className="text-xs text-muted">{ms.reason}</span>
        </p>
      ) : null}
      {view.conflicts.length ? (
        <div className="rounded-lg border border-warning bg-[#FFF8E6] p-3 text-sm" role="alert" data-testid="conflicts">
          <p className="font-semibold text-warning-text">확정 마감 충돌 {view.conflicts.length}건 — 규칙상 최종 마감보다 늦습니다.</p>
          <ul className="mt-1 space-y-0.5">
            {view.conflicts.map((c) => (
              <li key={c.key}>{c.title}: 확정 {fmt(c.confirmed)} → 늦어도 {fmt(c.latest)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <TemplateDialog projectId={projectId} view={view} />
          <Button size="sm" variant="secondary" onClick={() => setRecalcOpen(true)}>일괄 재계산</Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={recalcOpen}
        title="모든 표준 업무 마감을 다시 계산할까요?"
        description="확정한 마감도 규칙 엔진 계산값으로 바뀌고 '제안' 상태가 됩니다. 완료된 업무는 바뀌지 않습니다."
        confirmLabel="일괄 재계산"
        onCancel={() => setRecalcOpen(false)}
        onConfirm={async () => {
          setRecalcOpen(false);
          try {
            const res = await api<{ updated: number }>(`/api/projects/${projectId}/recalc`, { body: {} });
            toast(`마감 ${res.updated}건을 다시 계산했습니다.`);
            router.refresh();
          } catch (e) {
            toast((e as Error).message, { tone: "error" });
          }
        }}
      />
    </div>
  );
}

function TemplateDialog({ projectId, view }: { projectId: string; view: ProjectScheduleView }) {
  const router = useRouter();
  const candidates = view.result!.tasks.filter((t) => !view.existingKeys.includes(t.key));
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<TemplateKey[]>(candidates.map((c) => c.key));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (candidates.length === 0) return <span className="self-center text-xs text-muted">표준 업무가 모두 만들어져 있습니다.</span>;
  return (
    <Dialog.Root open={open} onOpenChange={(o) => (setOpen(o), setError(null), o && setPicked([]))}>
      <Dialog.Trigger asChild>
        <Button size="sm" variant="secondary"><Wand2 className="h-4 w-4" /> 표준 업무 만들기</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl focus:outline-none">
          <div className="mb-2 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">표준 업무 만들기</Dialog.Title>
            <Dialog.Close className="rounded-md p-1 hover:bg-bg" aria-label="닫기"><X className="h-5 w-5" /></Dialog.Close>
          </div>
          <Dialog.Description className="mb-3 text-sm text-muted">
            국서 역할을 바탕으로 한 <strong>참고용</strong> 표준 업무 목록입니다. 자동으로 만들지 않으며, 필요한 것만 직접 골라 만드세요(보통은 회의록 AI 제안이나 국서 공간의 “업무 추가”를 씁니다). 마감은 행사일에서 거꾸로 계산한 <strong>제안</strong> 값으로 들어가며, 나중에 고치면 확정됩니다.
          </Dialog.Description>
          <div className="mb-2 flex justify-end gap-2 text-xs">
            <button type="button" className="underline" onClick={() => setPicked(candidates.map((c) => c.key))}>모두 선택</button>
            <button type="button" className="underline" onClick={() => setPicked([])}>모두 해제</button>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border" aria-label="표준 업무 목록">
            {candidates.map((c) => (
              <li key={c.key} className="flex items-start gap-3 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  aria-label={TEMPLATES[c.key].title}
                  checked={picked.includes(c.key)}
                  onChange={() => setPicked(picked.includes(c.key) ? picked.filter((k) => k !== c.key) : [...picked, c.key])}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{TEMPLATES[c.key].title}</p>
                  <p className={cn("text-xs", c.feasible ? "text-muted" : "text-danger")}>{c.reason}</p>
                </div>
                <span className={cn("tabular shrink-0 text-xs", !c.feasible && "text-danger")}>{c.due ?? "기한 지남"}</span>
              </li>
            ))}
          </ul>
          <FormMessage>{error}</FormMessage>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild><Button variant="secondary">취소</Button></Dialog.Close>
            <Button
              disabled={pending || picked.length === 0}
              onClick={async () => {
                setPending(true);
                setError(null);
                try {
                  const res = await api<{ created: number }>(`/api/projects/${projectId}/template`, { body: { keys: picked } });
                  setOpen(false);
                  toast(`표준 업무 ${res.created}건을 만들었습니다.`);
                  router.refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? "만드는 중…" : `${picked.length}건 만들기`}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
