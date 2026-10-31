"use client";

import { Dialog } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Download, ExternalLink, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { DELIVERABLE_ACCEPT } from "./deliverables-tab";

type Item = {
  id: string; kind: "link" | "file" | "ai_example"; origin: "user" | "ai_search" | "ai_generated"; title: string; url: string | null;
  summary: string | null; relevance: string | null; points: string[]; content: string | null; format: "markdown" | "html" | "svg" | null;
  needsReview: boolean; requestId: string | null; fileName: string | null; preview: string | null; fileUrl: string | null; downloadUrl: string | null;
  by: string | null; at: string; canDelete: boolean;
};
type Req = {
  id: string; status: "queued" | "running" | "done" | "failed"; instruction: string | null; by: string | null; at: string; error: string | null;
  snapshot: { meeting?: { title: string; analysisVersion: number } | null; plan?: { versionNo: number; isDraft: boolean } | null; pastWork?: { title: string }[]; searchFailed?: boolean; searchNote?: string; notes?: string } | null;
};
type Data = {
  canAdd: boolean; aiAvailable: boolean;
  context: { meeting: { title: string; analysisVersion: number } | null; plan: { versionNo: number; isDraft: boolean } | null };
  requests: Req[]; items: Item[];
};

const time = (s: string) => new Date(s).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const EXT: Record<string, string> = { markdown: "md", html: "html", svg: "svg" };
const MIME: Record<string, string> = { markdown: "text/markdown", html: "text/html", svg: "image/svg+xml" };

/** 업무 드로어 › 레퍼런스 탭 (8-7): 사용자 링크·파일, AI 검색 레퍼런스, AI 예시안 + 제작 의뢰 */
export function ReferencesTab({ taskId, onChanged }: { taskId: string; onChanged: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<Data>(`/api/tasks/${taskId}/references`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [taskId]);
  useEffect(() => {
    let cancelled = false;
    api<Data>(`/api/tasks/${taskId}/references`)
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const pending = data?.requests.some((r) => r.status === "queued" || r.status === "running") ?? false;
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !pending) onChanged();
    was.current = pending;
    if (!pending) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [pending, load, onChanged]);

  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!data) return <div className="h-20 animate-pulse rounded-lg bg-bg" aria-busy="true" />;
  const user = data.items.filter((i) => i.origin === "user");
  const search = data.items.filter((i) => i.origin === "ai_search");
  const examples = data.items.filter((i) => i.origin === "ai_generated");
  const after = async () => {
    await load();
    onChanged();
  };

  return (
    <div className="space-y-5" data-testid="references-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">AI 레퍼런스·예시안은 참고용입니다. 그대로 쓰지 말고 고쳐 쓰세요.</p>
        {data.canAdd ? <RequestDialog taskId={taskId} ctx={data.context} aiAvailable={data.aiAvailable} disabled={pending} onDone={after} /> : null}
      </div>

      {data.requests.length ? (
        <ul className="space-y-1" aria-label="제작 의뢰">
          {data.requests.slice(0, 3).map((r) => (
            <li key={r.id} className="rounded-lg bg-bg px-3 py-2 text-sm" data-testid="reference-request">
              <span className="font-medium">
                {r.status === "done" ? "제작 완료" : r.status === "failed" ? "제작 실패" : r.status === "running" ? "AI가 찾고 만드는 중…" : "대기 중…"}
              </span>
              <span className="text-muted"> · {r.by} · {time(r.at)}</span>
              {r.instruction ? <p className="text-xs">지시: {r.instruction}</p> : null}
              <p className="text-xs text-muted">
                참고: {r.snapshot?.plan ? `기획안 v${r.snapshot.plan.versionNo}${r.snapshot.plan.isDraft ? "(초안 기준)" : "(결재본)"}` : "기획안 없음"}
                {r.snapshot?.meeting ? ` · 회의록 '${r.snapshot.meeting.title}'` : ""}
                {r.snapshot?.pastWork?.length ? ` · 과거 작업물 ${r.snapshot.pastWork.length}건` : ""}
              </p>
              {r.snapshot?.searchNote ? <p className={cn("text-xs", r.snapshot.searchFailed ? "text-warning-text" : "text-muted")}>{r.snapshot.searchNote}</p> : null}
              {r.error ? <p className="text-xs text-danger">{r.error}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <section aria-label="AI 예시안" className="space-y-2">
        <h3 className="text-sm font-semibold">AI 예시안</h3>
        {examples.length === 0 ? <p className="text-sm text-muted">아직 없습니다.</p> : null}
        {examples.map((i) => <Example key={i.id} i={i} onChanged={after} />)}
      </section>

      <section aria-label="AI 검색 레퍼런스" className="space-y-2">
        <h3 className="text-sm font-semibold">AI 검색 레퍼런스</h3>
        {search.length === 0 ? <p className="text-sm text-muted">아직 없습니다.</p> : null}
        <ul className="space-y-2">
          {search.map((i) => (
            <li key={i.id} className="rounded-lg border border-border p-3 text-sm" data-testid="search-reference">
              <div className="flex items-start justify-between gap-2">
                <a href={i.url!} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-start gap-1 font-medium underline">
                  {i.title} <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                </a>
                <DeleteButton i={i} onChanged={after} />
              </div>
              <p className="text-xs text-muted break-all">{i.url}</p>
              {i.summary ? <p className="mt-1">{i.summary}</p> : null}
              {i.points.length ? (
                <ul className="mt-1 list-disc pl-5 text-xs">{i.points.map((p, k) => <li key={k}>{p}</li>)}</ul>
              ) : null}
              {i.relevance ? <p className="mt-1 text-xs text-muted">이 업무와의 관계: {i.relevance}</p> : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="직접 추가한 레퍼런스" className="space-y-2">
        <h3 className="text-sm font-semibold">직접 추가한 레퍼런스</h3>
        {data.canAdd ? <AddForm taskId={taskId} onDone={after} /> : null}
        {user.length === 0 ? <p className="text-sm text-muted">아직 없습니다.</p> : null}
        <ul className="space-y-1">
          {user.map((i) => (
            <li key={i.id} className="flex items-start gap-2 rounded-lg border border-border p-2 text-sm">
              {i.preview === "image" && i.fileUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={i.fileUrl} alt={`${i.title} 미리보기`} className="h-12 w-12 shrink-0 rounded object-cover" />
              ) : null}
              <div className="min-w-0 flex-1">
                {i.url ? (
                  <a href={i.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline">{i.title}</a>
                ) : (
                  <a href={i.downloadUrl!} className="underline">{i.title}</a>
                )}
                {i.summary ? <p className="text-xs text-muted">{i.summary}</p> : null}
                <p className="text-xs text-muted">{i.by} · {time(i.at)}</p>
              </div>
              <DeleteButton i={i} onChanged={after} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function DeleteButton({ i, onChanged }: { i: Item; onChanged: () => Promise<void> }) {
  if (!i.canDelete) return null;
  return (
    <button
      className="text-muted hover:text-danger"
      aria-label={`레퍼런스 삭제: ${i.title}`}
      onClick={async () => {
        if (!window.confirm(`'${i.title}'을(를) 삭제할까요?`)) return;
        try {
          await api(`/api/references/${i.id}`, { method: "DELETE" });
          await onChanged();
        } catch (e) {
          toast((e as Error).message, { tone: "error" });
        }
      }}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

function Example({ i, onChanged }: { i: Item; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const content = i.content ?? "";
  const download = () => {
    const blob = new Blob([content], { type: `${MIME[i.format ?? "markdown"]};charset=utf-8` });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${i.title.replace(/[\\/:*?"<>|]/g, "_")}.${EXT[i.format ?? "markdown"]}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <article className="rounded-lg border border-border p-3 text-sm" data-testid="ai-example">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded border border-info px-1.5 py-0.5 text-xs text-info"><Sparkles className="h-3 w-3" />AI 예시안 — 벤치마킹용</span>
        {i.needsReview ? <span className="rounded border border-warning px-1.5 py-0.5 text-xs text-warning-text">발송 전 검토 필요</span> : null}
        <h4 className="font-medium">{i.title}</h4>
        <span className="text-xs text-muted">{i.summary}</span>
        <span className="ml-auto flex items-center gap-2">
          <button className="text-muted hover:text-text" aria-label={`복사: ${i.title}`} onClick={() => void navigator.clipboard.writeText(content).then(() => toast("복사했습니다."))}><Copy className="h-4 w-4" /></button>
          <button className="text-muted hover:text-text" aria-label={`내려받기: ${i.title}`} onClick={download}><Download className="h-4 w-4" /></button>
          <DeleteButton i={i} onChanged={onChanged} />
        </span>
      </div>
      <div className={cn("mt-2", !open && "max-h-60 overflow-hidden")}>
        {i.format === "svg" ? (
          // SVG 는 <img> 로만 표시 — 스크립트가 실행되지 않는다
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`} alt={`${i.title} 목업`} className="mx-auto max-h-96 rounded border border-border" />
        ) : i.format === "html" ? (
          // 스크립트·폼·외부 요청이 막힌 sandbox
          <iframe title={`${i.title} 미리보기`} sandbox="" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">${content}`} className="h-96 w-full rounded border border-border bg-white" />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm">{content}</pre>
        )}
      </div>
      {i.format === "markdown" && content.length > 600 ? (
        <button className="mt-1 text-xs underline" onClick={() => setOpen(!open)}>{open ? "접기" : "전체 보기"}</button>
      ) : null}
    </article>
  );
}

function AddForm({ taskId, onDone }: { taskId: string; onDone: () => Promise<void> }) {
  const [mode, setMode] = useState<"link" | "file">("link");
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      aria-label="레퍼런스 추가"
      className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (mode === "link") fd.delete("file");
        else fd.delete("url");
        setPending(true);
        try {
          const res = await fetch(`/api/tasks/${taskId}/references`, { method: "POST", body: fd });
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) throw new Error(body.error ?? "추가하지 못했습니다.");
          toast("레퍼런스를 추가했습니다.");
          ref.current?.reset();
          await onDone();
        } catch (err) {
          toast((err as Error).message, { tone: "error" });
        } finally {
          setPending(false);
        }
      }}
    >
      <select aria-label="추가 방식" className="h-8 rounded border border-border px-1 text-sm" value={mode} onChange={(e) => setMode(e.target.value as "link" | "file")}>
        <option value="link">링크</option>
        <option value="file">파일</option>
      </select>
      {mode === "link" ? (
        <Input name="url" type="url" required aria-label="레퍼런스 링크" placeholder="https://" className="h-8 min-w-48 flex-1" />
      ) : (
        <input name="file" type="file" required accept={DELIVERABLE_ACCEPT} aria-label="레퍼런스 파일" className="h-8 flex-1 text-sm" />
      )}
      <Input name="note" aria-label="레퍼런스 메모" placeholder="메모(선택)" className="h-8 w-40" maxLength={1000} />
      <Button size="sm" variant="secondary" type="submit" disabled={pending}>추가</Button>
    </form>
  );
}

function RequestDialog({ taskId, ctx, aiAvailable, disabled, onDone }: { taskId: string; ctx: Data["context"]; aiAvailable: boolean; disabled: boolean; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  if (!aiAvailable) return <span className="text-xs text-muted" data-testid="reference-ai-off">AI 일시 사용 불가 — 링크·파일은 직접 추가할 수 있습니다</span>;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button size="sm" disabled={disabled}><Sparkles className="h-4 w-4" />{disabled ? "제작 중…" : "레퍼런스 제작 의뢰"}</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/30" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-[60] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">레퍼런스 제작 의뢰</Dialog.Title>
            <Dialog.Close aria-label="닫기"><X className="h-5 w-5" /></Dialog.Close>
          </div>
          <Dialog.Description className="mb-3 text-sm text-muted">AI가 웹에서 사례를 찾아 정리하고, 국서 형식에 맞는 예시안을 만듭니다. 1~3분 걸리며 끝나면 알려 드립니다.</Dialog.Description>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              setPending(true);
              try {
                await api(`/api/tasks/${taskId}/references/request`, {
                  body: { instruction: String(fd.get("instruction") ?? ""), useMinutes: fd.get("useMinutes") === "on", usePlan: fd.get("usePlan") === "on", usePastWork: fd.get("usePastWork") === "on" },
                });
                toast("의뢰했습니다. 끝나면 알려 드립니다.");
                setOpen(false);
                await onDone();
              } catch (err) {
                toast((err as Error).message, { tone: "error" });
              } finally {
                setPending(false);
              }
            }}
          >
            <div>
              <Label htmlFor="ref-instruction">지시(선택)</Label>
              <textarea id="ref-instruction" name="instruction" rows={3} maxLength={2000} className="w-full rounded-lg border border-border p-2 text-sm" placeholder="예: 20대 대학생 감성의 카드뉴스, 5장 이내" />
            </div>
            <fieldset className="space-y-1 text-sm">
              <legend className="mb-1 font-medium">참고 자료</legend>
              <label className="flex items-center gap-2"><input type="checkbox" name="useMinutes" defaultChecked /> 회의록 {ctx.meeting ? <span className="text-muted">({ctx.meeting.title})</span> : <span className="text-muted">(연결된 회의록 없음)</span>}</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="usePlan" defaultChecked /> 기획안 {ctx.plan ? <span className="text-muted">(v{ctx.plan.versionNo} {ctx.plan.isDraft ? "초안 기준" : "결재본"})</span> : <span className="text-muted">(없음)</span>}</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="usePastWork" /> 과거 유사 작업물</label>
            </fieldset>
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild><Button type="button" variant="secondary" size="sm">취소</Button></Dialog.Close>
              <Button type="submit" size="sm" disabled={pending}>{pending ? "의뢰 중…" : "의뢰하기"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
