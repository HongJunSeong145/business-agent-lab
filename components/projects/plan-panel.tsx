"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Download, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type Fields = {
  title: string; datetime: string; venue: string; budget: number | null; host: string; organizer: string; purpose: string; content: string;
  timetable: { time: string; item: string }[]; budget_scenarios: { name: string; amount: number; note: string }[];
};
type Version = { id: string; versionNo: number; fields: Fields; note: string | null; author: string | null; at: string; approvedBy: string | null; approvedAt: string | null; file: { name: string; url: string; downloadUrl: string } | null };
type Data = {
  status: "draft" | "submitted" | "approved" | "rejected" | null;
  currentVersionId: string | null;
  approvedVersionId: string | null;
  versions: Version[];
  prefill: Fields;
  permissions: { edit: boolean; approve: boolean };
};

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "작성 중", cls: "border-border" },
  submitted: { label: "결재 요청", cls: "border-info text-info" },
  approved: { label: "결재 완료", cls: "border-success text-success" },
  rejected: { label: "반려", cls: "border-danger text-danger" },
};
const REQUIRED: [keyof Fields, string][] = [["title", "행사명"], ["datetime", "일시"], ["venue", "장소"], ["budget", "예산액"], ["host", "주최"], ["organizer", "주관"], ["purpose", "배경 및 목적"], ["content", "행사 내용"]];
const missingOf = (f: Fields) => REQUIRED.filter(([k]) => (k === "budget" ? f.budget === null : !f[k])).map(([, l]) => l);
const time = (s: string) => new Date(s).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** 사업 상세 › 기획안 (8-5): 양식 + 버전 + 결재 */
export function PlanPanel({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [form, setForm] = useState<Fields | null>(null);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<Data>(`/api/projects/${projectId}/plan`);
      setData(d);
      setForm(d.versions[0]?.fields ?? d.prefill);
      setViewId(null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);
  useEffect(() => {
    let cancelled = false;
    api<Data>(`/api/projects/${projectId}/plan`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setForm(d.versions[0]?.fields ?? d.prefill);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!data || !form) return <div className="h-24 animate-pulse rounded-lg bg-bg" aria-busy="true" />;

  const current = data.versions[0];
  const viewing = viewId ? data.versions.find((v) => v.id === viewId) : null;
  const shown = viewing?.fields ?? form;
  const editable = data.permissions.edit && !viewing;
  const missing = missingOf(shown);
  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setForm({ ...form, [k]: v });

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      await load();
      router.refresh();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const fd = new FormData();
    fd.set("fields", JSON.stringify(form));
    if (note.trim()) fd.set("note", note.trim());
    if (file) fd.set("file", file);
    await act(async () => {
      const res = await fetch(`/api/projects/${projectId}/plan`, { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { versionNo?: number; error?: string };
      if (!res.ok) throw new Error(body.error ?? "저장하지 못했습니다.");
      setNote("");
      setFile(null);
    }, "기획안을 새 버전으로 저장했습니다.");
  }

  const field = (k: "title" | "datetime" | "venue" | "host" | "organizer", label: string) => (
    <div>
      <Label htmlFor={`plan-${k}`}>{label}</Label>
      <Input id={`plan-${k}`} value={shown[k]} readOnly={!editable} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  return (
    <div className="space-y-4" data-testid="plan-panel">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {data.status ? (
          <span className={cn("rounded border px-2 py-0.5 text-xs font-medium", STATUS[data.status]!.cls)} data-testid="plan-status">{STATUS[data.status]!.label}</span>
        ) : (
          <span className="text-muted">아직 기획안이 없습니다. 사업 정보로 채운 양식에서 시작하세요.</span>
        )}
        {current ? <span className="text-muted">최신 v{current.versionNo} · {current.author} · {time(current.at)}</span> : null}
        {data.approvedVersionId ? (
          <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" />결재본 v{data.versions.find((v) => v.id === data.approvedVersionId)?.versionNo}</span>
        ) : null}
        {data.versions.length > 1 ? (
          <Select aria-label="버전 보기" className="ml-auto h-8 w-44" value={viewId ?? ""} onChange={(e) => setViewId(e.target.value || null)}>
            <option value="">{data.permissions.edit ? "최신(편집)" : "최신"}</option>
            {data.versions.slice(1).map((v) => <option key={v.id} value={v.id}>v{v.versionNo}{v.approvedAt ? " (결재)" : ""} — {time(v.at)}</option>)}
          </Select>
        ) : null}
      </div>
      {viewing ? <p className="rounded-lg bg-bg px-3 py-2 text-sm" role="status">v{viewing.versionNo} 보기 전용{viewing.note ? ` — ${viewing.note}` : ""}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {field("title", "행사명")}
        {field("datetime", "일시")}
        {field("venue", "장소")}
        <div>
          <Label htmlFor="plan-budget">예산액(원)</Label>
          <Input id="plan-budget" type="number" min={0} value={shown.budget ?? ""} readOnly={!editable} onChange={(e) => set("budget", e.target.value === "" ? null : Number(e.target.value))} />
        </div>
        {field("host", "주최")}
        {field("organizer", "주관")}
      </div>
      <div>
        <Label htmlFor="plan-purpose">배경 및 목적</Label>
        <textarea id="plan-purpose" rows={3} className="w-full rounded-lg border border-border p-2 text-sm" value={shown.purpose} readOnly={!editable} onChange={(e) => set("purpose", e.target.value)} />
      </div>
      <div>
        <Label htmlFor="plan-content">행사 내용</Label>
        <textarea id="plan-content" rows={5} className="w-full rounded-lg border border-border p-2 text-sm" value={shown.content} readOnly={!editable} onChange={(e) => set("content", e.target.value)} />
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">타임테이블(필요 시)</legend>
        <ul className="space-y-1">
          {shown.timetable.map((r, i) => (
            <li key={i} className="flex gap-2">
              <Input aria-label={`타임테이블 ${i + 1} 시간`} className="h-8 w-28" value={r.time} readOnly={!editable} onChange={(e) => set("timetable", form.timetable.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))} />
              <Input aria-label={`타임테이블 ${i + 1} 내용`} className="h-8" value={r.item} readOnly={!editable} onChange={(e) => set("timetable", form.timetable.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)))} />
              {editable ? <button aria-label={`타임테이블 ${i + 1} 삭제`} onClick={() => set("timetable", form.timetable.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button> : null}
            </li>
          ))}
        </ul>
        {editable ? <button className="mt-1 inline-flex items-center gap-1 text-sm underline" onClick={() => set("timetable", [...form.timetable, { time: "", item: "" }])}><Plus className="h-3.5 w-3.5" />시간 추가</button> : null}
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">예산 시나리오(재정국 협의, 최대 5개)</legend>
        <ul className="space-y-1">
          {shown.budget_scenarios.map((r, i) => (
            <li key={i} className="flex gap-2">
              <Input aria-label={`시나리오 ${i + 1} 이름`} placeholder="최소/표준/확대" className="h-8 w-28" value={r.name} readOnly={!editable} onChange={(e) => set("budget_scenarios", form.budget_scenarios.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input aria-label={`시나리오 ${i + 1} 금액`} type="number" min={0} className="h-8 w-36" value={r.amount} readOnly={!editable} onChange={(e) => set("budget_scenarios", form.budget_scenarios.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
              <Input aria-label={`시나리오 ${i + 1} 메모`} className="h-8" value={r.note} readOnly={!editable} onChange={(e) => set("budget_scenarios", form.budget_scenarios.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
              {editable ? <button aria-label={`시나리오 ${i + 1} 삭제`} onClick={() => set("budget_scenarios", form.budget_scenarios.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button> : null}
            </li>
          ))}
        </ul>
        {editable && form.budget_scenarios.length < 5 ? <button className="mt-1 inline-flex items-center gap-1 text-sm underline" onClick={() => set("budget_scenarios", [...form.budget_scenarios, { name: "", amount: 0, note: "" }])}><Plus className="h-3.5 w-3.5" />시나리오 추가</button> : null}
      </fieldset>

      {(viewing ?? current)?.file ? (
        <p className="text-sm">
          첨부: <a className="inline-flex items-center gap-1 underline" href={(viewing ?? current)!.file!.downloadUrl}><Download className="h-3.5 w-3.5" />{(viewing ?? current)!.file!.name}</a>
        </p>
      ) : null}

      {missing.length ? <p className="text-xs text-warning-text">결재 전 채울 항목: {missing.join(", ")}</p> : null}

      {editable ? (
        <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="plan-note">이번 버전 메모(선택)</Label>
            <Input id="plan-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="무엇을 바꿨는지" />
          </div>
          <div>
            <Label htmlFor="plan-file">파일 첨부(선택, PDF·DOCX·HWPX·HWP)</Label>
            <input id="plan-file" type="file" accept=".pdf,.docx,.hwpx,.hwp" className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {editable ? <Button size="sm" disabled={busy} onClick={() => void save()}>새 버전으로 저장</Button> : null}
        {editable && current && data.status !== "approved" && data.status !== "submitted" ? (
          <Button size="sm" variant="secondary" disabled={busy || missingOf(current.fields).length > 0} onClick={() => void act(() => api(`/api/projects/${projectId}/plan/submit`, { method: "POST" }), "결재를 요청했습니다.")}>
            결재 요청
          </Button>
        ) : null}
        {data.permissions.approve && current && !current.approvedAt && !viewing ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`기획안 v${current.versionNo}을 결재할까요? 결재를 기다리던 업무가 착수 가능 상태로 바뀝니다.`)) return;
                void act(async () => {
                  const r = await api<{ unblocked: { title: string }[] }>(`/api/projects/${projectId}/plan/approve`, { method: "POST" });
                  if (r.unblocked.length) toast(`착수 가능해진 업무 ${r.unblocked.length}개: ${r.unblocked.map((u) => u.title).slice(0, 3).join(", ")}${r.unblocked.length > 3 ? " 외" : ""}`);
                }, `기획안 v${current.versionNo}을 결재했습니다.`);
              }}
            >
              결재
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt("반려 사유를 입력하세요.");
                if (reason?.trim()) void act(() => api(`/api/projects/${projectId}/plan/reject`, { body: { reason } }), "반려했습니다.");
              }}
            >
              반려
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
