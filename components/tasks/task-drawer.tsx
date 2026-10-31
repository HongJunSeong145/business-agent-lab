"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Lock, Trash2, X } from "lucide-react";
import { effectiveProgress, progressSource, type Readiness } from "@kgb/rules";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { DeptChip } from "@/components/dept/dept-chip";
import { ProgressBar } from "@/components/dept/progress-bar";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import type { DepartmentCode } from "@/lib/design/tokens";
import { cn } from "@/lib/utils";
import { useOptions } from "./use-options";

type Detail = {
  task: {
    id: string; title: string; description: string | null; status: string; due_date: string | null; due_state: string; due_reason: string | null;
    weight: string; ai_progress: number | null; manual_progress: number | null; is_completed: boolean; allow_draft_start: boolean; started_on_draft_plan: boolean;
    acceptance_criteria: { text: string; done: boolean }[] | null;
    project: { id: string; title: string; status: string } | null;
    departments: { id: string; role: "lead" | "support"; department_id: string; department: { code: DepartmentCode; name_ko: string } }[];
    assignees: { user: { id: string; display_name: string } }[];
    dependencies: { id: string; type: string; depends_on: { id: string; title: string; status: string; is_completed: boolean; deleted_at: string | null } }[];
    dependents: { id: string; type: string; task: { id: string; title: string; status: string; deleted_at: string | null } }[];
  };
  effective: number;
  readiness: Readiness;
  history: ({ at: string; by: string | null } & ({ kind: "progress"; field: string; old: string | null; new: string | null; reason: string | null } | { kind: "activity"; action: string; diff: unknown }))[];
  permissions: { edit: boolean; complete: boolean; progress: boolean; leader: boolean };
};

const STATUS: Record<string, string> = { blocked: "차단", todo: "할 일", in_progress: "진행 중", review: "검토", done: "완료", cancelled: "취소" };
const DEP: Record<string, string> = { finish_to_start: "완료 후 착수", approval_required: "결재 후 착수", draft_ok: "초안 있으면 착수" };
const ACTION: Record<string, string> = {
  "task.create": "업무 생성", "task.update": "업무 수정", "task.auto_status": "상태 자동 변경", "task.dependency_add": "선행 업무 추가",
  "task.dependency_remove": "선행 업무 제거", "task.delete": "삭제",
};

function historyText(h: Detail["history"][number]): string {
  if (h.kind === "progress") {
    if (h.field === "completed") return h.new === "true" ? `완료 체크 (${h.reason ?? "사용자 완료 확정"})` : "완료 해제";
    const label = h.field === "ai" ? "AI 평가" : "수동 진척도";
    if (h.new === null) return `${label} 해제${h.reason ? ` — ${h.reason}` : ""}`;
    return `${label} ${h.old ?? "-"}% → ${h.new}%`;
  }
  const base = ACTION[h.action] ?? h.action;
  if (h.action === "task.auto_status") {
    const d = h.diff as { before?: string; after?: string } | null;
    return `${base}: ${STATUS[d?.before ?? ""] ?? d?.before} → ${STATUS[d?.after ?? ""] ?? d?.after}`;
  }
  if (h.action === "task.update") {
    const after = ((h.diff as { after?: Record<string, unknown> } | null)?.after ?? {}) as Record<string, unknown>;
    const keys: Record<string, string> = { title: "업무명", description: "설명", due_date: "마감", due_state: "마감 상태", status: "상태", weight: "가중치", acceptance_criteria: "완료 기준", lead_department_id: "주관 국서", support_department_ids: "협조 국서", assignee_ids: "담당자", allow_draft_start: "초안 기반 선착수" };
    const parts = Object.keys(after).map((k) => (k === "status" ? `상태 → ${STATUS[String(after[k])] ?? after[k]}` : k === "due_date" ? `마감 → ${after[k] ?? "없음"}` : keys[k] ?? k));
    return `${base}: ${parts.join(", ")}`;
  }
  return base;
}

export function TaskDrawerBody({ id, onTitle }: { id: string; onTitle: (t: string) => void }) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "deliverables" | "references" | "history">("overview");
  const [editAssign, setEditAssign] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<Detail>(`/api/tasks/${id}`);
      setD(data);
      onTitle(data.task.title);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, onTitle]);

  useEffect(() => {
    let cancelled = false;
    api<Detail>(`/api/tasks/${id}`)
      .then((data) => {
        if (cancelled) return;
        setD(data);
        onTitle(data.task.title);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id, onTitle]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      await load();
      router.refresh();
      if (ok) toast(ok);
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
      await load();
    }
  }
  const patch = (body: Record<string, unknown>, ok?: string) => run(() => api(`/api/tasks/${id}`, { method: "PATCH", body }), ok);

  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!d) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="h-5 w-2/3 animate-pulse rounded bg-bg" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-bg" />
      </div>
    );
  }

  const t = d.task;
  const lead = t.departments.find((x) => x.role === "lead")!;
  const state = { is_completed: t.is_completed, manual_progress: t.manual_progress, ai_progress: t.ai_progress };
  const criteria = t.acceptance_criteria ?? [];
  const cancelled = t.status === "cancelled";

  return (
    <div className="space-y-5" data-testid="task-drawer">
      {/* 헤더 */}
      <div className="space-y-2">
        {d.permissions.edit ? (
          <Input
            aria-label="업무명"
            defaultValue={t.title}
            key={t.title}
            className="text-base font-semibold"
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            onBlur={(e) => e.target.value.trim() && e.target.value !== t.title && void patch({ title: e.target.value.trim() }, "업무명을 바꿨습니다.")}
          />
        ) : (
          <p className="text-base font-semibold">{t.title}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          {t.project ? (
            <Link href={`/projects/${t.project.id}`} className="text-muted underline">{t.project.title}</Link>
          ) : (
            <span className="text-muted">사업 외 업무</span>
          )}
          {t.departments.map((x) => <DeptChip key={x.id} code={x.department.code} role={x.role} />)}
        </div>
      </div>

      <div role="tablist" className="flex gap-1 border-b border-border">
        {([["overview", "개요"], ["deliverables", "작업물"], ["references", "레퍼런스"], ["history", "이력"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === k ? "border-text font-semibold" : "border-transparent text-muted")}>
            {l}
          </button>
        ))}
      </div>

      {tab === "deliverables" ? <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">작업물 업로드·버전·AI 평가는 Phase 6에서 제공됩니다.</p> : null}
      {tab === "references" ? <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">레퍼런스·예시안 제작 의뢰는 Phase 7에서 제공됩니다.</p> : null}

      {tab === "history" ? (
        <ol className="space-y-2 text-sm" aria-label="업무 이력">
          {d.history.length === 0 ? <li className="text-muted">이력이 없습니다.</li> : null}
          {d.history.map((h, i) => (
            <li key={i} className="flex gap-3 border-b border-border pb-2">
              <time className="tabular w-28 shrink-0 text-xs text-muted">{new Date(h.at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
              <span className="flex-1">{historyText(h)}</span>
              <span className="text-xs text-muted">{h.by ?? ""}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {tab === "overview" ? (
        <div className="space-y-5">
          {t.status === "blocked" ? (
            <p className="flex items-start gap-2 rounded-lg bg-bg px-3 py-2 text-sm" role="status">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" /> 차단됨 — {d.readiness.reasons.join(", ")}
            </p>
          ) : null}
          {t.started_on_draft_plan && !t.is_completed ? (
            <p className="flex items-start gap-2 rounded-lg border border-dashed border-warning px-3 py-2 text-sm text-warning-text">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> 초안 기준으로 먼저 착수한 업무입니다. 결재본이 바뀌면 다시 확인하세요.
            </p>
          ) : null}

          <dl className="grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-3 text-sm">
            <dt className="text-muted">상태</dt>
            <dd>
              {(d.permissions.edit || d.permissions.progress) && !t.is_completed && t.status !== "blocked" ? (
                <Select aria-label="상태" value={t.status} onChange={(e) => void patch({ status: e.target.value })} className="h-9 w-40">
                  {(cancelled ? ["cancelled", "todo"] : ["todo", "in_progress", "review", ...(d.permissions.edit ? ["cancelled"] : [])]).map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}
                </Select>
              ) : (
                <span>{STATUS[t.status]}</span>
              )}
            </dd>

            <dt className="text-muted">진척도</dt>
            <dd className="space-y-2">
              <ProgressBar code={lead.department.code} value={effectiveProgress(state)} source={progressSource(state)} label="업무 진척도" />
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                <label className="flex items-center gap-1.5 text-sm text-text">
                  <input
                    type="checkbox"
                    aria-label="완료"
                    className="h-4 w-4 accent-[#2E7D4F]"
                    checked={t.is_completed}
                    disabled={!d.permissions.complete || t.status === "blocked" || cancelled}
                    onChange={(e) => {
                      const completed = e.target.checked;
                      // 낙관적 업데이트 — 실패하면 run() 이 서버 값으로 다시 불러온다
                      setD((prev) => (prev ? { ...prev, task: { ...prev.task, is_completed: completed } } : prev));
                      void run(() => api(`/api/tasks/${id}/complete`, { body: { completed } }), completed ? "완료 처리했습니다." : "완료를 해제했습니다.");
                    }}
                  />
                  완료
                </label>
                <span>AI {t.ai_progress ?? "-"}%</span>
                <span>수동 {t.manual_progress ?? "-"}%</span>
              </div>
              {d.permissions.progress && !t.is_completed && !cancelled ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = Number(new FormData(e.currentTarget).get("manual"));
                    void run(() => api(`/api/tasks/${id}/progress`, { body: { value: v } }), "진척도를 바꿨습니다.");
                  }}
                >
                  <Input name="manual" aria-label="수동 진척도(%)" type="number" min={0} max={100} defaultValue={t.manual_progress ?? effectiveProgress(state)} key={`${t.manual_progress}`} className="h-8 w-20" />
                  <Button size="sm" variant="secondary" type="submit">진척도 저장</Button>
                  {t.manual_progress !== null ? (
                    <button type="button" className="text-xs text-muted underline" onClick={() => void run(() => api(`/api/tasks/${id}/progress`, { body: { value: null } }), "AI 평가로 되돌렸습니다.")}>
                      AI 평가로 되돌리기
                    </button>
                  ) : null}
                </form>
              ) : null}
            </dd>

            <dt className="text-muted">마감</dt>
            <dd className="space-y-1">
              {d.permissions.edit ? (
                <Input
                  type="date"
                  aria-label="마감일"
                  className="h-9 w-44"
                  defaultValue={t.due_date?.slice(0, 10) ?? ""}
                  key={t.due_date ?? "none"}
                  onBlur={(e) => e.target.value !== (t.due_date?.slice(0, 10) ?? "") && void patch({ due_date: e.target.value }, "마감을 바꿨습니다(확정).")}
                />
              ) : (
                <span>{t.due_date?.slice(0, 10) ?? "없음"}</span>
              )}
              {t.due_date ? (
                <p className="text-xs text-muted">
                  <span className={cn("mr-1 rounded px-1", t.due_state === "proposed" ? "border border-dashed border-border" : "border border-border")}>{t.due_state === "proposed" ? "제안" : "확정"}</span>
                  {t.due_reason}
                  {t.due_state === "proposed" && d.permissions.edit ? (
                    <button className="ml-2 underline" onClick={() => void patch({ due_state: "confirmed" }, "마감을 확정했습니다.")}>마감 확정</button>
                  ) : null}
                </p>
              ) : null}
            </dd>

            {!d.permissions.edit && d.permissions.progress && !t.is_completed && !cancelled ? (
              <>
                <dt className="text-muted">마감 변경</dt>
                <dd>
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      void run(() => api(`/api/tasks/${id}/deadline-request`, { body: { due_date: fd.get("req_due"), reason: fd.get("req_reason") } }), "마감 변경을 요청했습니다. 국장이 검토합니다.");
                      e.currentTarget.reset();
                    }}
                  >
                    <Input name="req_due" type="date" aria-label="요청할 마감일" required className="h-8 w-40" />
                    <Input name="req_reason" aria-label="요청 사유" placeholder="사유(선택)" className="h-8 w-40" />
                    <Button size="sm" variant="secondary" type="submit">변경 요청</Button>
                  </form>
                </dd>
              </>
            ) : null}

            <dt className="text-muted">담당자</dt>
            <dd>{t.assignees.length ? t.assignees.map((a) => a.user.display_name).join(", ") : "미정"}</dd>
          </dl>

          {d.permissions.edit ? (
            editAssign ? (
              <AssignEditor
                current={{ lead: lead.department_id, support: t.departments.filter((x) => x.role === "support").map((x) => x.department_id), assignees: t.assignees.map((a) => a.user.id), weight: Number(t.weight) }}
                onCancel={() => setEditAssign(false)}
                onSave={async (v) => {
                  await patch(v, "배정을 바꿨습니다.");
                  setEditAssign(false);
                }}
              />
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setEditAssign(true)}>국서·담당자·가중치 편집</Button>
            )
          ) : null}

          <section>
            <h3 className="mb-1 text-sm font-semibold">설명</h3>
            {d.permissions.edit ? (
              <textarea
                aria-label="설명"
                defaultValue={t.description ?? ""}
                key={t.description ?? ""}
                rows={3}
                className="w-full rounded-lg border border-border p-2 text-sm"
                onBlur={(e) => e.target.value !== (t.description ?? "") && void patch({ description: e.target.value || null }, "설명을 저장했습니다.")}
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm">{t.description || <span className="text-muted">없음</span>}</p>
            )}
          </section>

          <section>
            <h3 className="mb-1 text-sm font-semibold">완료 기준</h3>
            {criteria.length === 0 ? <p className="text-sm text-muted">없음</p> : null}
            <ul className="space-y-1">
              {criteria.map((c, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`완료 기준: ${c.text}`}
                    checked={c.done}
                    disabled={!d.permissions.edit}
                    onChange={() => void patch({ acceptance_criteria: criteria.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })}
                  />
                  <span className={cn(c.done && "text-muted line-through")}>{c.text}</span>
                  {d.permissions.edit ? (
                    <button aria-label="기준 삭제" className="ml-auto text-muted" onClick={() => void patch({ acceptance_criteria: criteria.filter((_, j) => j !== i) })}><X className="h-3.5 w-3.5" /></button>
                  ) : null}
                </li>
              ))}
            </ul>
            {d.permissions.edit ? (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = String(new FormData(e.currentTarget).get("c") ?? "").trim();
                  if (text) void patch({ acceptance_criteria: [...criteria, { text, done: false }] });
                  e.currentTarget.reset();
                }}
              >
                <Input name="c" aria-label="완료 기준 추가" placeholder="완료 기준 추가" className="h-8" />
                <Button size="sm" variant="secondary" type="submit">추가</Button>
              </form>
            ) : null}
          </section>

          <section>
            <h3 className="mb-1 text-sm font-semibold">선행 업무</h3>
            <ul className="space-y-1 text-sm">
              {t.dependencies.filter((x) => !x.depends_on.deleted_at).map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2 rounded bg-bg px-2 py-1">
                  <span>
                    <Link href={`?task=${x.depends_on.id}`} scroll={false} className="underline">{x.depends_on.title}</Link>
                    <span className="text-muted"> · {DEP[x.type]} · {STATUS[x.depends_on.status]}</span>
                  </span>
                  {d.permissions.edit ? (
                    <button aria-label={`선행 업무 제거: ${x.depends_on.title}`} onClick={() => void run(() => api(`/api/tasks/${id}/dependencies/${x.id}`, { method: "DELETE" }), "선행 업무를 뺐습니다.")}>
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </li>
              ))}
              {t.dependencies.length === 0 ? <li className="text-muted">없음</li> : null}
            </ul>
            {d.permissions.edit ? <AddDependency taskId={id} exclude={[id, ...t.dependencies.map((x) => x.depends_on.id)]} onAdd={(body) => run(() => api(`/api/tasks/${id}/dependencies`, { body }), "선행 업무를 추가했습니다.")} /> : null}
            {d.permissions.edit && t.dependencies.some((x) => x.type === "approval_required") ? (
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={t.allow_draft_start} onChange={(e) => void patch({ allow_draft_start: e.target.checked })} />
                초안 기반 선착수 허용 (결재 전이라도 초안이 있으면 착수)
              </label>
            ) : null}
          </section>

          <section>
            <h3 className="mb-1 text-sm font-semibold">후속 업무</h3>
            <ul className="space-y-1 text-sm">
              {t.dependents.filter((x) => !x.task.deleted_at).map((x) => (
                <li key={x.id}>
                  <Link href={`?task=${x.task.id}`} scroll={false} className="underline">{x.task.title}</Link>
                  <span className="text-muted"> · {STATUS[x.task.status]}</span>
                </li>
              ))}
              {t.dependents.length === 0 ? <li className="text-muted">없음</li> : null}
            </ul>
          </section>

          {d.permissions.edit ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              onClick={() => {
                if (!window.confirm("이 업무를 삭제할까요? 후속 업무의 선행 관계도 함께 풀립니다.")) return;
                void run(() => api(`/api/tasks/${id}`, { method: "DELETE" }), "업무를 삭제했습니다.").then(() => {
                  const q = new URLSearchParams(window.location.search);
                  q.delete("task");
                  router.replace(`${window.location.pathname}${q.size ? `?${q}` : ""}`, { scroll: false });
                });
              }}
            >
              <Trash2 className="h-4 w-4" /> 업무 삭제
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AddDependency({ taskId, exclude, onAdd }: { taskId: string; exclude: string[]; onAdd: (b: { depends_on_task_id: string; type: string }) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const { data } = useOptions(open);
  const [pick, setPick] = useState({ id: "", type: "finish_to_start" });
  if (!open) return <button className="mt-2 text-sm underline" onClick={() => setOpen(true)}>선행 업무 추가</button>;
  return (
    <div className="mt-2 flex gap-2" key={taskId}>
      <Select aria-label="추가할 선행 업무" value={pick.id} onChange={(e) => setPick({ ...pick, id: e.target.value })}>
        <option value="">{data ? "선행 업무 선택" : "불러오는 중…"}</option>
        {data?.tasks.filter((x) => !exclude.includes(x.id)).map((x) => <option key={x.id} value={x.id}>{x.title}{x.project ? ` (${x.project})` : ""}</option>)}
      </Select>
      <Select aria-label="의존 유형" value={pick.type} onChange={(e) => setPick({ ...pick, type: e.target.value })} className="w-40 shrink-0">
        {Object.entries(DEP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select>
      <Button size="sm" disabled={!pick.id} onClick={() => void onAdd({ depends_on_task_id: pick.id, type: pick.type }).then(() => (setPick({ ...pick, id: "" }), setOpen(false)))}>추가</Button>
    </div>
  );
}

function AssignEditor({
  current,
  onSave,
  onCancel,
}: {
  current: { lead: string; support: string[]; assignees: string[]; weight: number };
  onSave: (v: { lead_department_id: string; support_department_ids: string[]; assignee_ids: string[]; weight: number }) => Promise<void>;
  onCancel: () => void;
}) {
  const { data } = useOptions(true);
  const [lead, setLead] = useState(current.lead);
  const [support, setSupport] = useState(current.support);
  const [assignees, setAssignees] = useState(current.assignees);
  const [weight, setWeight] = useState(current.weight);
  const toggle = (l: string[], v: string) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v]);
  if (!data) return <p className="text-sm text-muted">불러오는 중…</p>;
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div>
        <Label htmlFor="edit-lead">주관 국서</Label>
        <Select id="edit-lead" value={lead} onChange={(e) => (setLead(e.target.value), setSupport(support.filter((s) => s !== e.target.value)))}>
          {data.departments.map((x) => <option key={x.id} value={x.id}>{x.name_ko}</option>)}
        </Select>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">협조 국서</legend>
        <div className="flex flex-wrap gap-3">
          {data.departments.filter((x) => x.id !== lead).map((x) => (
            <label key={x.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={support.includes(x.id)} onChange={() => setSupport(toggle(support, x.id))} /> {x.name_ko}</label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">담당자</legend>
        <div className="grid max-h-32 grid-cols-2 gap-1 overflow-y-auto">
          {data.members.map((m) => (
            <label key={m.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={assignees.includes(m.id)} onChange={() => setAssignees(toggle(assignees, m.id))} /> <span className="truncate">{m.name}</span></label>
          ))}
        </div>
      </fieldset>
      <div>
        <Label htmlFor="edit-weight">가중치</Label>
        <Input id="edit-weight" type="number" min={0.5} max={100} step={0.5} value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="w-28" />
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>취소</Button>
        <Button size="sm" onClick={() => void onSave({ lead_department_id: lead, support_department_ids: support, assignee_ids: assignees, weight })}>저장</Button>
      </div>
    </div>
  );
}
