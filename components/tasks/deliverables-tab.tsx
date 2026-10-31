"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileUp, Link2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

export const DELIVERABLE_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.pptx,.hwpx,.hwp,.txt,.md,.mp4,.mov,.webm";

type Verdict = "met" | "partial" | "unmet";
type Version = {
  id: string;
  versionNo: number;
  fileName: string | null;
  mime: string | null;
  size: number | null;
  note: string | null;
  externalUrl: string | null;
  uploadedBy: string | null;
  at: string;
  preview: "image" | "pdf" | "video" | "text" | "link" | "none";
  url: string | null;
  downloadUrl: string | null;
  textExcerpt: string | null;
  evaluable: boolean;
  notEvaluableReason: string | null;
  evaluationStatus: "queued" | "running" | "succeeded" | "failed" | "waiting_budget" | null;
  evaluationError: string | null;
  evaluation: {
    id: string; score: number; criteria: { criterion: string; verdict: Verdict; evidence: string }[];
    missing_items: string[]; suggestions: string[]; summary: string | null; model: string | null; at: string;
  } | null;
};
type Data = {
  canUpload: boolean;
  aiAvailable: boolean;
  deliverables: { id: string; title: string; currentVersionId: string | null; canDelete: boolean; versions: Version[] }[];
};

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  met: { label: "충족", cls: "border-success text-success" },
  partial: { label: "부분", cls: "border-warning text-warning-text" },
  unmet: { label: "미충족", cls: "border-danger text-danger" },
};

const time = (s: string) => new Date(s).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const sizeLabel = (n: number | null) => (n === null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);

/** 업로드 요청 (드로어·업무 행 공용) */
export async function postDeliverable(taskId: string, fd: FormData): Promise<{ versionNo: number; aiJobId: string | null }> {
  const res = await fetch(`/api/tasks/${taskId}/deliverables`, { method: "POST", body: fd });
  const body = (await res.json().catch(() => ({}))) as { versionNo?: number; aiJobId?: string | null; error?: string };
  if (!res.ok) throw new Error(body.error ?? "업로드하지 못했습니다. 다시 시도하세요.");
  return { versionNo: body.versionNo ?? 1, aiJobId: body.aiJobId ?? null };
}

/** 업무 드로어 › 작업물 탭 (8-7): 버전 목록·미리보기·최신 AI 평가·업로드 */
export function DeliverablesTab({ taskId, onChanged }: { taskId: string; onChanged: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>(`/api/tasks/${taskId}/deliverables`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;
    api<Data>(`/api/tasks/${taskId}/deliverables`)
      .then((r) => !cancelled && setData(r))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // 평가 중이면 2.5초마다 확인 → 끝나면 업무 진척도도 다시 불러온다
  const pending = data?.deliverables.some((d) => d.versions.some((v) => v.evaluationStatus === "queued" || v.evaluationStatus === "running")) ?? false;
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) onChanged();
    wasPending.current = pending;
    if (!pending) return;
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [pending, load, onChanged]);

  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!data) return <div className="h-20 animate-pulse rounded-lg bg-bg" aria-busy="true" />;

  const after = async () => {
    await load();
    onChanged();
  };

  return (
    <div className="space-y-5" data-testid="deliverables-tab">
      {!data.aiAvailable ? (
        <p className="rounded-lg bg-bg px-3 py-2 text-sm text-muted" role="status">AI 일시 사용 불가 — 작업물은 올릴 수 있고, 진척도는 직접 입력하세요.</p>
      ) : null}
      {data.canUpload ? <UploadForm taskId={taskId} deliverables={data.deliverables} onDone={after} /> : null}
      {data.deliverables.length === 0 ? <p className="text-sm text-muted">아직 올린 작업물이 없습니다.</p> : null}
      {data.deliverables.map((d) => (
        <DeliverableCard key={d.id} d={d} canUpload={data.canUpload} aiAvailable={data.aiAvailable} onChanged={after} />
      ))}
    </div>
  );
}

function UploadForm({ taskId, deliverables, onDone }: { taskId: string; deliverables: Data["deliverables"]; onDone: () => Promise<void> }) {
  const [mode, setMode] = useState<"file" | "link">("file");
  const [file, setFile] = useState<File | null>(null);
  // 사용자가 고르지 않았으면 가장 최근 작업물의 새 버전이 기본(첫 업로드 뒤에도 따라감)
  const [chosen, setTarget] = useState<string | null>(null);
  const target = chosen !== null && (chosen === "" || deliverables.some((d) => d.id === chosen)) ? chosen : (deliverables.at(-1)?.id ?? "");
  const [drag, setDrag] = useState(false);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (mode === "file") {
      if (!file) return toast("올릴 파일을 고르세요.", { tone: "error" });
      fd.set("file", file);
      fd.delete("externalUrl");
    } else fd.delete("file");
    if (target) fd.set("deliverableId", target);
    else fd.delete("deliverableId");
    setPending(true);
    try {
      const r = await postDeliverable(taskId, fd);
      toast(`v${r.versionNo} 업로드 완료.${r.aiJobId ? " AI가 평가 중입니다." : ""}`);
      setFile(null);
      setTarget(null);
      formRef.current?.reset();
      await onDone();
    } catch (err) {
      toast((err as Error).message, { tone: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-3 rounded-lg border border-border p-3" aria-label="작업물 업로드">
      <div className="flex items-center gap-2 text-sm">
        <button type="button" onClick={() => setMode("file")} className={cn("rounded-md px-2 py-1", mode === "file" ? "bg-bg font-semibold" : "text-muted")} aria-pressed={mode === "file"}>
          <FileUp className="mr-1 inline h-4 w-4" />파일
        </button>
        <button type="button" onClick={() => setMode("link")} className={cn("rounded-md px-2 py-1", mode === "link" ? "bg-bg font-semibold" : "text-muted")} aria-pressed={mode === "link"}>
          <Link2 className="mr-1 inline h-4 w-4" />링크
        </button>
      </div>
      {mode === "file" ? (
        <div
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            setFile(e.dataTransfer.files[0] ?? null);
          }}
          className={cn("flex flex-col items-center gap-1 rounded-lg border-2 border-dashed p-4 text-center text-sm", drag ? "border-text bg-bg" : "border-border")}
        >
          <p>{file ? <strong>{file.name}</strong> : "파일을 끌어다 놓거나"}</p>
          <button type="button" className="underline" onClick={() => inputRef.current?.click()}>{file ? "다른 파일 고르기" : "파일 고르기"}</button>
          <input ref={inputRef} type="file" accept={DELIVERABLE_ACCEPT} className="sr-only" aria-label="작업물 파일" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <p className="text-xs text-muted">이미지·PDF·DOCX·PPTX·HWPX·HWP·TXT·MD·동영상</p>
        </div>
      ) : (
        <div>
          <Label htmlFor="dl-url">링크(Canva·Figma·드라이브 등)</Label>
          <Input id="dl-url" name="externalUrl" type="url" placeholder="https://" required />
          <p className="mt-1 text-xs text-muted">링크는 AI가 열어 볼 수 없어 진척도를 직접 입력해야 합니다.</p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="dl-target">올릴 곳</Label>
          <Select id="dl-target" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">새 작업물</option>
            {deliverables.map((d) => (
              <option key={d.id} value={d.id}>{d.title} — 새 버전(v{(d.versions[0]?.versionNo ?? 0) + 1})</option>
            ))}
          </Select>
        </div>
        {target === "" ? (
          <div>
            <Label htmlFor="dl-title">작업물 이름(선택)</Label>
            <Input id="dl-title" name="title" placeholder="비우면 파일 이름" maxLength={150} />
          </div>
        ) : null}
      </div>
      <div>
        <Label htmlFor="dl-note">메모(선택)</Label>
        <Input id="dl-note" name="note" placeholder="무엇을 바꿨는지 등" maxLength={2000} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>{pending ? "올리는 중…" : "올리기"}</Button>
      </div>
    </form>
  );
}

function DeliverableCard({ d, canUpload, aiAvailable, onChanged }: { d: Data["deliverables"][number]; canUpload: boolean; aiAvailable: boolean; onChanged: () => Promise<void> }) {
  // 고른 버전을 보여주되, 고른 뒤에 새 버전이 올라오면 최신 버전으로 돌아간다
  const latest = d.versions[0]?.id ?? null;
  const [pick, setPick] = useState<{ id: string; latestAtPick: string | null } | null>(null);
  const selected = pick && pick.latestAtPick === latest ? pick.id : latest;
  const setSelected = (id: string) => setPick({ id, latestAtPick: latest });
  const v = d.versions.find((x) => x.id === selected) ?? d.versions[0];
  return (
    <section className="space-y-3 rounded-lg border border-border p-3" aria-label={`작업물 ${d.title}`} data-testid="deliverable">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-semibold">{d.title}</h3>
        {d.canDelete ? (
          <button
            className="text-muted hover:text-danger"
            aria-label={`작업물 삭제: ${d.title}`}
            onClick={async () => {
              if (!window.confirm(`'${d.title}' 작업물을 삭제할까요? 모든 버전이 목록에서 사라집니다.`)) return;
              try {
                await api(`/api/deliverables/${d.id}`, { method: "DELETE" });
                toast("작업물을 삭제했습니다.");
                await onChanged();
              } catch (e) {
                toast((e as Error).message, { tone: "error" });
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <ol className="space-y-1" aria-label="버전 목록">
        {d.versions.map((x) => (
          <li key={x.id}>
            <button
              onClick={() => setSelected(x.id)}
              aria-current={x.id === v?.id ? "true" : undefined}
              className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs", x.id === v?.id ? "bg-bg" : "hover:bg-bg")}
            >
              {x.preview === "image" && x.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={x.url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-bg text-[10px] text-muted">{x.externalUrl ? "링크" : (x.fileName?.split(".").pop() ?? "").toUpperCase()}</span>
              )}
              <span className="font-semibold">v{x.versionNo}</span>
              <span className="min-w-0 flex-1 truncate">{x.note ?? x.fileName ?? x.externalUrl}</span>
              <span className="text-muted">{x.uploadedBy} · {time(x.at)}</span>
              {x.evaluation ? <span className="tabular rounded border border-border px-1">{x.evaluation.score}%</span> : null}
            </button>
          </li>
        ))}
      </ol>
      {v ? <VersionView v={v} canUpload={canUpload} aiAvailable={aiAvailable} onChanged={onChanged} /> : null}
    </section>
  );
}

function VersionView({ v, canUpload, aiAvailable, onChanged }: { v: Version; canUpload: boolean; aiAvailable: boolean; onChanged: () => Promise<void> }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>{v.fileName ?? "링크"} {sizeLabel(v.size)}</span>
        {v.downloadUrl ? (
          <a href={v.downloadUrl} className="inline-flex items-center gap-1 underline"><Download className="h-3.5 w-3.5" />내려받기</a>
        ) : null}
        {v.externalUrl ? (
          <a href={v.externalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline"><ExternalLink className="h-3.5 w-3.5" />링크 열기</a>
        ) : null}
      </div>
      {v.note ? <p className="text-sm"><span className="text-muted">메모 </span>{v.note}</p> : null}
      <Preview v={v} />
      <Evaluation v={v} canUpload={canUpload} aiAvailable={aiAvailable} onChanged={onChanged} />
    </div>
  );
}

function Preview({ v }: { v: Version }) {
  if (v.preview === "image" && v.url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={v.url} alt={`${v.fileName ?? "작업물"} 미리보기`} className="max-h-96 w-full rounded-lg border border-border bg-bg object-contain" />;
  }
  if (v.preview === "pdf" && v.url) return <iframe src={v.url} title={`${v.fileName ?? "PDF"} 미리보기`} className="h-96 w-full rounded-lg border border-border" />;
  if (v.preview === "video" && v.url) return <video src={v.url} controls className="max-h-96 w-full rounded-lg border border-border" aria-label={`${v.fileName ?? "동영상"} 미리보기`} />;
  if (v.preview === "text") {
    return v.textExcerpt ? (
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-bg p-3 text-xs" aria-label="추출 텍스트 미리보기">{v.textExcerpt}</pre>
    ) : (
      <p className="text-sm text-muted">미리보기할 글자를 찾지 못했습니다. 내려받아 확인하세요.</p>
    );
  }
  return null;
}

function Evaluation({ v, canUpload, aiAvailable, onChanged }: { v: Version; canUpload: boolean; aiAvailable: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const reevaluate = async () => {
    setBusy(true);
    try {
      await api(`/api/deliverables/versions/${v.id}/evaluate`, { method: "POST" });
      toast("다시 평가를 시작했습니다.");
      await onChanged();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const canRetry = canUpload && aiAvailable && v.evaluable;
  const running = v.evaluationStatus === "queued" || v.evaluationStatus === "running";

  if (!v.evaluable) {
    return <p className="rounded-lg bg-bg px-3 py-2 text-sm" role="status" data-testid="eval-status">AI 평가 불가 — 수동 진척도를 입력하세요. <span className="text-muted">({v.notEvaluableReason})</span></p>;
  }
  if (running) return <p className="rounded-lg bg-bg px-3 py-2 text-sm" role="status" data-testid="eval-status">AI 평가 중…</p>;
  const e = v.evaluation;
  if (!e) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg bg-bg px-3 py-2 text-sm" role="status" data-testid="eval-status">
        <span>
          {v.evaluationStatus === "failed"
            ? "AI 평가 실패 — 다시 평가하거나 진척도를 직접 입력하세요."
            : v.evaluationStatus === "waiting_budget"
              ? "오늘 AI 예산을 모두 써서 내일 평가합니다."
              : aiAvailable
                ? "아직 AI 평가가 없습니다."
                : "AI 일시 사용 불가 — 진척도를 직접 입력하세요."}
        </span>
        {canRetry ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void reevaluate()}><RefreshCw className="h-3.5 w-3.5" />평가</Button> : null}
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-lg border border-border p-3" data-testid="evaluation">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          AI 평가 <span className="tabular text-lg" data-testid="eval-score">{e.score}%</span>
        </p>
        <span className="text-xs text-muted">{time(e.at)}{v.evaluationStatus === "failed" ? " · 최근 재평가 실패" : ""}</span>
      </div>
      {e.summary ? <p className="text-sm">{e.summary}</p> : null}
      <table className="w-full text-sm">
        <caption className="sr-only">기준별 판정</caption>
        <thead>
          <tr className="text-left text-xs text-muted">
            <th scope="col" className="py-1 font-normal">기준</th>
            <th scope="col" className="w-16 py-1 font-normal">판정</th>
          </tr>
        </thead>
        <tbody>
          {e.criteria.map((c, i) => (
            <tr key={i} className="border-t border-border align-top">
              <td className="py-1.5 pr-2">
                <p>{c.criterion}</p>
                {c.evidence ? <p className="text-xs text-muted">{c.evidence}</p> : null}
              </td>
              <td className="py-1.5">
                <span className={cn("rounded border px-1.5 py-0.5 text-xs", VERDICT[c.verdict].cls)}>{VERDICT[c.verdict].label}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {e.missing_items.length ? (
        <div>
          <h4 className="text-xs font-semibold">부족 항목</h4>
          <ul className="list-disc pl-5 text-sm">{e.missing_items.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      ) : null}
      {e.suggestions.length ? (
        <div>
          <h4 className="text-xs font-semibold">개선 제안</h4>
          <ul className="list-disc pl-5 text-sm">{e.suggestions.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      ) : null}
      <div className="flex items-center justify-between text-xs text-muted">
        <span>AI 평가는 추천값입니다. 진척도는 개요 탭에서 직접 조정할 수 있습니다.</span>
        {canRetry ? <button className="underline disabled:opacity-50" disabled={busy} onClick={() => void reevaluate()}>다시 평가</button> : null}
      </div>
    </div>
  );
}
