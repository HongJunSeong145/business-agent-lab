"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { DeptChip } from "@/components/dept/dept-chip";
import { api } from "@/lib/client-api";
import { DEPARTMENTS, DEPARTMENT_CODES, type DepartmentCode } from "@/lib/design/tokens";
import type { ReviewGroup, ReviewItem } from "@/lib/review";
import { cn } from "@/lib/utils";

type Edit = { title?: string; event_start?: string | null; lead_department?: DepartmentCode; support_departments?: DepartmentCode[]; due_date?: string | null };

const KIND: Record<string, string> = { new_project: "새 사업", update_project: "사업 변경", new_task: "새 업무", deadline: "마감 변경 요청" };
const FIELD: Record<string, string> = { event_start: "행사일", venue: "장소", expected_beneficiaries: "수혜 인원", uses_external_vendor: "외부업체", funding: "재원" };
const fmt = (v: unknown) => (Array.isArray(v) ? v.map((x) => (x === "school" ? "교비" : x === "student_fee" ? "학생회비" : x)).join("·") : v === true ? "이용" : v === false ? "없음" : v === null || v === undefined ? "없음" : String(v));

/** AI 제안 검토 (8-4): 항목별 체크·수정 → 선택 승인 / 모두 거절 */
export function ReviewBoard({ groups }: { groups: ReviewGroup[] }) {
  const router = useRouter();
  const all = useMemo(() => groups.flatMap((g) => [...g.projects.flatMap((p) => p.items), ...g.others]), [groups]);
  // D8: 추론 항목은 기본 체크 해제
  const [checked, setChecked] = useState<Set<string>>(() => new Set(all.filter((i) => !i.inferred).map((i) => i.id)));
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [pending, setPending] = useState(false);
  const [rejectAll, setRejectAll] = useState(false);

  const toggle = (id: string) => setChecked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const edit = (id: string, e: Edit) => setEdits((x) => ({ ...x, [id]: { ...x[id], ...e } }));

  async function submit(body: { approve: { id: string; edits?: Edit }[]; reject: string[] }) {
    setPending(true);
    try {
      const r = await api<{ projects: number; tasks: number; updates: number; deadlines: number; rejected: number; projectIds: string[] }>("/api/proposals/decide", { body });
      const parts = [r.projects && `사업 ${r.projects}건`, r.tasks && `업무 ${r.tasks}건`, r.updates && `사업 변경 ${r.updates}건`, r.deadlines && `마감 변경 ${r.deadlines}건`].filter(Boolean);
      toast(`${parts.length ? `${parts.join(", ")} 승인` : ""}${r.rejected ? `${parts.length ? ", " : ""}${r.rejected}건 거절` : ""}했습니다.`, {
        action: r.projectIds[0] ? { label: "사업에서 보기", onClick: () => router.push(`/projects/${r.projectIds[0]}`) } : undefined,
        ms: 8000,
      });
      setEdits({});
      router.refresh();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    } finally {
      setPending(false);
    }
  }

  const selected = all.filter((i) => checked.has(i.id));
  return (
    <div className="space-y-6 pb-24">
      {groups.map((g) => (
        <section key={g.id} aria-label={`출처: ${g.label}`} className="space-y-3">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {g.meetingId ? <Link href={`/minutes?id=${g.meetingId}&tab=summary`} className="hover:underline">{g.label}</Link> : g.label}
          </h2>
          {g.projects.map((pg) => (
            <div key={pg.key} className="rounded-xl border border-border bg-surface" data-review-project={pg.title}>
              <div className="border-b border-border px-4 py-2 text-sm font-semibold">
                {pg.isNew ? <span className="mr-2 rounded bg-[#EEF3F8] px-1.5 py-0.5 text-xs text-info">새 사업</span> : <span className="mr-2 rounded bg-bg px-1.5 py-0.5 text-xs text-muted">기존 사업</span>}
                {pg.title}
              </div>
              <ul className="divide-y divide-border">
                {pg.items.map((i) => <Row key={i.id} item={i} meetingId={g.meetingId} checked={checked.has(i.id)} onToggle={() => toggle(i.id)} edit={edits[i.id] ?? {}} onEdit={(e) => edit(i.id, e)} />)}
              </ul>
            </div>
          ))}
          {g.others.length ? (
            <div className="rounded-xl border border-border bg-surface">
              <div className="border-b border-border px-4 py-2 text-sm font-semibold">{g.meetingId ? "사업 외 업무" : "요청"}</div>
              <ul className="divide-y divide-border">
                {g.others.map((i) => <Row key={i.id} item={i} meetingId={g.meetingId} checked={checked.has(i.id)} onToggle={() => toggle(i.id)} edit={edits[i.id] ?? {}} onEdit={(e) => edit(i.id, e)} />)}
              </ul>
            </div>
          ) : null}
        </section>
      ))}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span className="text-sm text-muted">전체 {all.length}건 중 <strong className="text-text tabular">{selected.length}</strong>건 선택 · 추론 항목은 기본 선택 해제</span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={pending || all.length === 0} onClick={() => setRejectAll(true)}>모두 거절</Button>
            <Button
              disabled={pending || selected.length === 0}
              onClick={() => void submit({ approve: selected.map((i) => ({ id: i.id, edits: edits[i.id] && Object.keys(edits[i.id]!).length ? edits[i.id] : undefined })), reject: [] })}
            >
              {pending ? "처리 중…" : `선택 승인 (${selected.length})`}
            </Button>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={rejectAll}
        title="대기 중인 제안을 모두 거절할까요?"
        description={`${all.length}건이 거절 처리됩니다. 거절한 제안은 다시 승인할 수 없습니다(재분석하면 새로 제안됩니다).`}
        confirmLabel="모두 거절"
        onCancel={() => setRejectAll(false)}
        onConfirm={() => {
          setRejectAll(false);
          void submit({ approve: [], reject: all.map((i) => i.id) });
        }}
      />
    </div>
  );
}

function Row({ item: i, meetingId, checked, onToggle, edit, onEdit }: { item: ReviewItem; meetingId: string | null; checked: boolean; onToggle: () => void; edit: Edit; onEdit: (e: Edit) => void }) {
  const p = i.payload as Record<string, unknown>;
  const lead = (edit.lead_department ?? p.lead_department) as DepartmentCode | undefined;
  const support = (edit.support_departments ?? (p.support_departments as DepartmentCode[] | undefined) ?? []).filter((d) => d !== lead);
  const due = edit.due_date !== undefined ? edit.due_date : (p.due_date as string | null | undefined) ?? null;
  const feasible = p.due_feasible !== false;
  return (
    <li className={cn("grid gap-2 px-4 py-3 text-sm md:grid-cols-[auto_1fr_auto]", !checked && "bg-bg/60")} data-proposal={i.title} data-kind={i.kind}>
      <input type="checkbox" className="mt-1 h-4 w-4" checked={checked} onChange={onToggle} aria-label={`${KIND[i.kind] ?? i.kind}: ${i.title} 선택`} />
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-bg px-1.5 py-0.5 text-xs font-medium">{KIND[i.kind] ?? i.kind}</span>
          {i.inferred ? (
            <span className="inline-flex items-center gap-1 rounded border border-dashed border-warning px-1.5 py-0.5 text-xs text-warning-text" title={i.inferenceReason ?? ""}>
              <Sparkles className="h-3 w-3" /> 추론
            </span>
          ) : null}
          {i.kind === "new_project" || i.kind === "new_task" ? (
            <input
              aria-label="제목"
              className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-medium hover:border-border focus:border-info focus:outline-none"
              defaultValue={i.title}
              onBlur={(e) => e.target.value.trim() && e.target.value !== i.title && onEdit({ title: e.target.value.trim() })}
            />
          ) : (
            <span className="font-medium">{i.title}</span>
          )}
        </div>

        {i.kind === "new_task" && lead ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-muted">
              주관
              <select aria-label="주관 국서" className="h-7 rounded border border-border bg-surface text-xs" value={lead} onChange={(e) => onEdit({ lead_department: e.target.value as DepartmentCode })}>
                {DEPARTMENT_CODES.map((d) => <option key={d} value={d}>{DEPARTMENTS[d].nameKo}</option>)}
              </select>
            </label>
            <span className="text-xs text-muted">협조</span>
            {DEPARTMENT_CODES.filter((d) => d !== lead).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={support.includes(d)}
                onClick={() => onEdit({ support_departments: support.includes(d) ? support.filter((x) => x !== d) : [...support, d] })}
                className={cn("rounded", !support.includes(d) && "opacity-40")}
                aria-label={`협조 ${DEPARTMENTS[d].nameKo}`}
              >
                <DeptChip code={d} />
              </button>
            ))}
            {p.assignee_hint ? <span className="text-xs text-muted">담당: {String(p.assignee_hint)}</span> : null}
          </div>
        ) : null}

        {i.kind === "new_project" ? (
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <label className="flex items-center gap-1">행사일 <input aria-label="행사일" type="date" className="h-7 rounded border border-border px-1 text-xs text-text" defaultValue={(p.event_start as string) ?? ""} onBlur={(e) => onEdit({ event_start: e.target.value || null })} /></label>
            <span>장소 {fmt(p.venue)}</span>
            <span>수혜 {fmt(p.expected_beneficiaries)}</span>
            <span>재원 {fmt(p.funding) || "미정"}</span>
            <span>외부업체 {fmt(p.uses_external_vendor)}</span>
          </div>
        ) : null}

        {i.kind === "update_project" ? (
          <ul className="text-xs">
            {Object.entries((p.changes as Record<string, unknown>) ?? {}).map(([k, v]) => (
              <li key={k}>{FIELD[k] ?? k}: <span className="text-muted line-through">{fmt(i.before?.[k])}</span> → <strong>{fmt(v)}</strong></li>
            ))}
          </ul>
        ) : null}

        {i.kind === "deadline" ? (
          <p className="text-xs">
            마감 <span className="text-muted line-through">{fmt(i.before?.due_date)}</span> → <strong>{String(p.due_date)}</strong>{p.reason ? ` · 사유: ${String(p.reason)}` : ""}
          </p>
        ) : null}

        {i.evidence.length ? (
          <ul className="space-y-0.5 text-xs text-muted">
            {i.evidence.map((e, k) => (
              <li key={k}>
                근거{" "}
                {meetingId ? <Link href={`/minutes?id=${meetingId}&tab=original#p-${e.para}`} className="underline">¶{e.para}</Link> : `¶${e.para}`} “{e.quote}”
                {e.grounded === false ? <span className="ml-1 text-warning-text">(원문에서 찾지 못함)</span> : null}
              </li>
            ))}
          </ul>
        ) : i.inferred ? (
          <p className="text-xs text-muted">추론 근거: {i.inferenceReason}</p>
        ) : null}
      </div>

      {i.kind === "new_task" ? (
        <div className="space-y-1 text-xs md:w-56">
          <label className="flex items-center gap-1">
            추천 마감
            <input aria-label="마감" type="date" className="h-7 rounded border border-border px-1" defaultValue={due ?? ""} onBlur={(e) => (e.target.value || null) !== (p.due_date ?? null) && onEdit({ due_date: e.target.value || null })} />
          </label>
          {p.due_reason ? (
            <p className={cn("leading-snug", feasible ? "text-muted" : "text-danger")} title={String(p.due_reason)}>
              {!feasible ? <AlertTriangle className="mr-1 inline h-3 w-3" /> : null}
              {String(p.due_reason).length > 70 ? `${String(p.due_reason).slice(0, 70)}…` : String(p.due_reason)}
            </p>
          ) : null}
          {i.confidence !== null ? <p className="text-muted">확신도 {Math.round(i.confidence * 100)}%</p> : null}
        </div>
      ) : i.confidence !== null ? (
        <p className="text-xs text-muted md:w-56">확신도 {Math.round(i.confidence * 100)}%</p>
      ) : null}
    </li>
  );
}
