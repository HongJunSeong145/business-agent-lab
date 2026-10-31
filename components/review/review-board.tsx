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

const KIND: Record<string, string> = { new_project: "새 사업", update_project: "사업 변경", new_task: "새 업무", deadline: "마감 변경", update_task: "업무 변경", cancel: "업무 취소" };
const FIELD: Record<string, string> = {
  event_start: "행사일", venue: "장소", expected_beneficiaries: "수혜 인원", uses_external_vendor: "외부업체", funding: "재원",
  title: "업무명", description: "설명", lead_department: "주관 국서", support_departments: "협조 국서", due_date: "마감",
};
const DEPT_KO: Record<string, string> = { planning: "기획국", finance: "재정국", secretariat: "사무국", promotion: "홍보국", operations: "집행국" };
const fmt = (v: unknown) =>
  Array.isArray(v)
    ? v.map((x) => (x === "school" ? "교비" : x === "student_fee" ? "학생회비" : DEPT_KO[x as string] ?? x)).join("·") || "없음"
    : v === true ? "이용" : v === false ? "없음" : v === null || v === undefined ? "없음" : DEPT_KO[String(v)] ?? String(v);

/** AI 제안 검토 (8-4): 항목별 체크·수정 → 선택 승인 / 모두 거절 */
type Manual = { tmp: string; projectKey: string | null; title: string; dept: DepartmentCode; due: string | null };

export function ReviewBoard({ groups }: { groups: ReviewGroup[] }) {
  const router = useRouter();
  const all = useMemo(() => groups.flatMap((g) => [...g.projects.flatMap((p) => p.items), ...g.others]), [groups]);
  // D8: 추론 항목은 기본 체크 해제
  const [checked, setChecked] = useState<Set<string>>(() => new Set(all.filter((i) => !i.inferred).map((i) => i.id)));
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [manual, setManual] = useState<Manual[]>([]);
  const [pending, setPending] = useState(false);
  const [rejectAll, setRejectAll] = useState(false);

  const toggle = (id: string) => setChecked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const edit = (id: string, e: Edit) => setEdits((x) => ({ ...x, [id]: { ...x[id], ...e } }));
  /** 국서 칸 배치: 사람이 주관 국서를 바꾸면 그 국서 칸으로 옮겨 보인다 */
  const deptOf = (i: ReviewItem) => ((edits[i.id]?.lead_department ?? i.dept) || null) as DepartmentCode | null;

  async function submit(body: { approve: { id: string; edits?: Edit }[]; reject: string[]; create?: { project_key: string | null; title: string; lead_department: string; support_departments: string[]; due_date: string | null }[] }) {
    setPending(true);
    try {
      const r = await api<{ projects: number; tasks: number; updates: number; deadlines: number; rejected: number; projectIds: string[] }>("/api/proposals/decide", { body });
      const parts = [r.projects && `사업 ${r.projects}건`, r.tasks && `업무 ${r.tasks}건`, r.updates && `변경 ${r.updates}건`, r.deadlines && `마감 변경 ${r.deadlines}건`].filter(Boolean);
      toast(`${parts.length ? `${parts.join(", ")} 승인` : ""}${r.rejected ? `${parts.length ? ", " : ""}${r.rejected}건 거절` : ""}했습니다.`, {
        action: r.projectIds[0] ? { label: "사업에서 보기", onClick: () => router.push(`/projects/${r.projectIds[0]}`) } : undefined,
        ms: 8000,
      });
      setEdits({});
      setManual([]);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    } finally {
      setPending(false);
    }
  }

  const selected = all.filter((i) => checked.has(i.id));
  const rowProps = (i: ReviewItem, meetingId: string | null) => ({ item: i, meetingId, checked: checked.has(i.id), onToggle: () => toggle(i.id), edit: edits[i.id] ?? {}, onEdit: (e: Edit) => edit(i.id, e) });

  /** 사업 하나: 사업 단위 항목 → 국서별(기획·재정·사무·홍보·집행) 제안 + 이미 있는 업무 + 직접 추가 */
  const renderProject = (pg: ReviewGroup["projects"][number], meetingId: string | null, isOthers = false) => {
    const projectItems = pg.items.filter((i) => i.kind === "new_project" || i.kind === "update_project");
    const rest = pg.items.filter((i) => !projectItems.includes(i));
    return (
      <div key={pg.key} className="rounded-xl border border-border bg-surface" data-review-project={pg.title}>
        <div className="border-b border-border px-4 py-2 text-sm font-semibold">
          {isOthers ? null : pg.isNew ? <span className="mr-2 rounded bg-[#EEF3F8] px-1.5 py-0.5 text-xs text-info">새 사업</span> : <span className="mr-2 rounded bg-bg px-1.5 py-0.5 text-xs text-muted">기존 사업</span>}
          {pg.title}
        </div>
        {projectItems.length ? <ul className="divide-y divide-border border-b border-border">{projectItems.map((i) => <Row key={i.id} {...rowProps(i, meetingId)} />)}</ul> : null}
        <div className="divide-y divide-border">
          {DEPARTMENT_CODES.map((code) => {
            const items = rest.filter((i) => (deptOf(i) ?? "planning") === code);
            const existing = pg.existing.filter((e) => e.dept === code);
            const mine = manual.filter((m) => m.projectKey === (isOthers ? null : pg.key) && m.dept === code);
            const t = DEPARTMENTS[code];
            return (
              <section key={code} aria-label={`${t.nameKo} 업무`} data-review-dept={code}>
                <h3 className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold" style={{ backgroundColor: t.chipBg, color: t.ink }}>
                  {t.nameKo}
                  <span className="font-normal">제안 {items.length}{existing.length ? ` · 이미 배정 ${existing.length}` : ""}{mine.length ? ` · 직접 추가 ${mine.length}` : ""}</span>
                </h3>
                <ul className="divide-y divide-border">
                  {items.map((i) => <Row key={i.id} {...rowProps(i, meetingId)} />)}
                  {mine.map((m) => (
                    <li key={m.tmp} className="grid gap-2 px-4 py-2 text-sm md:grid-cols-[1fr_auto]" data-manual={m.title}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-[#EAF4EC] px-1.5 py-0.5 text-xs font-medium text-success">직접 추가</span>
                        <input aria-label="직접 추가 업무명" className="min-w-0 flex-1 rounded border border-border px-1 py-0.5" value={m.title} onChange={(e) => setManual((xs) => xs.map((x) => (x.tmp === m.tmp ? { ...x, title: e.target.value } : x)))} />
                        <select aria-label="직접 추가 주관 국서" className="h-7 rounded border border-border bg-surface text-xs" value={m.dept} onChange={(e) => setManual((xs) => xs.map((x) => (x.tmp === m.tmp ? { ...x, dept: e.target.value as DepartmentCode } : x)))}>
                          {DEPARTMENT_CODES.map((d) => <option key={d} value={d}>{DEPARTMENTS[d].nameKo}</option>)}
                        </select>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <label className="flex items-center gap-1">마감 <input aria-label="직접 추가 마감" type="date" className="h-7 rounded border border-border px-1" value={m.due ?? ""} onChange={(e) => setManual((xs) => xs.map((x) => (x.tmp === m.tmp ? { ...x, due: e.target.value || null } : x)))} /></label>
                        <button className="underline" onClick={() => setManual((xs) => xs.filter((x) => x.tmp !== m.tmp))}>빼기</button>
                      </div>
                    </li>
                  ))}
                  {existing.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-1.5 text-xs text-muted" data-existing={e.title}>
                      <span className="rounded border border-border px-1.5 py-0.5">이미 배정</span>
                      <span className={e.done ? "line-through" : "text-text"}>{e.title}</span>
                      <span className="tabular">마감 {e.due ?? "없음"}{e.due ? (e.dueState === "confirmed" ? " (확정)" : " (제안)") : ""}</span>
                      {e.previewDue ? <span className="text-warning-text">→ 행사일 변경 승인 시 {e.previewDue}로 다시 계산</span> : null}
                    </li>
                  ))}
                  {items.length + existing.length + mine.length === 0 ? <li className="px-4 py-1.5 text-xs text-muted">없음</li> : null}
                </ul>
                <div className="px-4 pb-2">
                  <button
                    className="text-xs underline"
                    onClick={() => setManual((xs) => [...xs, { tmp: `${Date.now()}-${Math.random()}`, projectKey: isOthers ? null : pg.key, title: "", dept: code, due: null }])}
                  >
                    + {t.nameKo} 업무 직접 추가
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    );
  };

  const validManual = manual.filter((m) => m.title.trim());
  return (
    <div className="space-y-6 pb-24">
      {groups.map((g) => (
        <section key={g.id} aria-label={`출처: ${g.label}`} className="space-y-3">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {g.meetingId ? <Link href={`/minutes?id=${g.meetingId}&tab=summary`} className="hover:underline">{g.label}</Link> : g.label}
          </h2>
          {g.projects.map((pg) => renderProject(pg, g.meetingId))}
          {g.others.length ? renderProject({ key: `others-${g.id}`, title: g.meetingId ? "사업 외 업무" : "요청", isNew: false, items: g.others, existing: [] }, g.meetingId, true) : null}
        </section>
      ))}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span className="text-sm text-muted">
            전체 {all.length}건 중 <strong className="text-text tabular">{selected.length}</strong>건 선택{validManual.length ? ` · 직접 추가 ${validManual.length}건` : ""} · 추론 항목은 기본 선택 해제
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={pending || all.length === 0} onClick={() => setRejectAll(true)}>모두 거절</Button>
            <Button
              disabled={pending || selected.length + validManual.length === 0}
              onClick={() =>
                void submit({
                  approve: selected.map((i) => ({ id: i.id, edits: edits[i.id] && Object.keys(edits[i.id]!).length ? edits[i.id] : undefined })),
                  reject: [],
                  create: validManual.map((m) => ({ project_key: m.projectKey, title: m.title.trim(), lead_department: m.dept, support_departments: [], due_date: m.due })),
                })
              }
            >
              {pending ? "처리 중…" : `선택 승인 (${selected.length + validManual.length})`}
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
  const ch = (p.changes as Record<string, unknown> | undefined) ?? {};
  const isTask = i.kind === "new_task" || i.kind === "update_task";
  const lead = (edit.lead_department ?? p.lead_department ?? ch.lead_department ?? i.dept ?? undefined) as DepartmentCode | undefined;
  const support = (edit.support_departments ?? (p.support_departments as DepartmentCode[] | undefined) ?? (ch.support_departments as DepartmentCode[] | undefined) ?? []).filter((d) => d !== lead);
  const due = edit.due_date !== undefined ? edit.due_date : ((p.due_date ?? ch.due_date ?? i.before?.due_date) as string | null | undefined) ?? null;
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
          {i.kind === "new_project" || isTask ? (
            <input
              aria-label="제목"
              className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-medium hover:border-border focus:border-info focus:outline-none"
              defaultValue={i.kind === "update_task" ? String(ch.title ?? i.title) : i.title}
              onBlur={(e) => e.target.value.trim() && e.target.value !== i.title && onEdit({ title: e.target.value.trim() })}
            />
          ) : (
            <span className="font-medium">{i.title}</span>
          )}
        </div>

        {isTask && lead ? (
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
            <span className="text-xs text-muted">담당자는 승인 후 국장이 국서 공간에서 지정</span>
          </div>
        ) : null}

        {i.kind === "new_project" && !(edit.event_start ?? p.event_start) ? (
          <p className="rounded border border-warning bg-[#FFF8E6] px-2 py-1 text-xs text-warning-text" role="status" data-testid="event-date-ask">
            회의록에 행사 당일 날짜가 없습니다. 아래 &lsquo;행사일&rsquo;에 지금 입력하거나, 비워 두고 승인한 뒤 사업 화면에서 입력하세요. 날짜가 정해지면 마감이 자동으로 계산됩니다.
          </p>
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

        {i.kind === "update_task" ? (
          <ul className="text-xs" data-testid="update-task">
            {Object.entries((p.changes as Record<string, unknown>) ?? {}).map(([k, v]) => (
              <li key={k}>{FIELD[k] ?? k}: {k === "description" ? <strong>{fmt(v)}</strong> : <><span className="text-muted line-through">{fmt(i.before?.[k])}</span> → <strong>{fmt(v)}</strong></>}</li>
            ))}
            {p.reason ? <li className="text-muted">이유: {String(p.reason)}</li> : null}
          </ul>
        ) : null}
        {i.kind === "cancel" ? <p className="text-xs text-danger">이 업무를 취소합니다{p.reason ? ` — ${String(p.reason)}` : ""}</p> : null}
        {i.kind === "update_project" && p.reason ? <p className="text-xs text-muted">{String(p.reason)}</p> : null}

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

      {isTask ? (
        <div className="space-y-1 text-xs md:w-56">
          <label className="flex items-center gap-1">
            {i.kind === "update_task" ? "마감" : "추천 마감"}
            <input aria-label="마감" type="date" className="h-7 rounded border border-border px-1" defaultValue={due ?? ""} onBlur={(e) => (e.target.value || null) !== ((p.due_date ?? ch.due_date ?? null) as string | null) && onEdit({ due_date: e.target.value || null })} />
          </label>
          {i.kind === "update_task" && i.before && "due_date" in i.before ? <p className="text-muted">지금 마감: {String(i.before.due_date ?? "없음")}</p> : null}
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
