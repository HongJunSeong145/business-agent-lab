"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { api } from "@/lib/client-api";
import { toast } from "@/components/ui/toast";
import { emitChanged, useLive } from "@/components/layout/live-refresh";

type Data = { tasks: { id: string; title: string; deleted_at: string; project: { id: string; title: string } | null }[]; projects: { id: string; title: string; deleted_at: string }[] };
const when = (s: string) => new Date(s).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** 최근 삭제한 사업·업무 — 되살리기(연결된 선후관계·차단·진척도·캘린더 함께 복원) */
export function TrashPanel({ query = "" }: { query?: string }) {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<Data>(`/api/trash${query ? `?${query}` : ""}`));
    } catch {
      setData(null); // 권한 없음 등 — 표시하지 않음
    }
  }, [query]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(() => void load());
  if (!data || (data.tasks.length === 0 && data.projects.length === 0)) return null;
  const restore = async (url: string, label: string) => {
    try {
      await api(url, { body: {} });
      toast(`'${label}'을(를) 되살렸습니다.`);
      router.refresh();
      emitChanged();
      await load();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    }
  };
  return (
    <details className="rounded-lg border border-border bg-surface px-4 py-2 text-sm" data-testid="trash-panel">
      <summary className="cursor-pointer text-muted">최근 삭제 {data.projects.length + data.tasks.length}건 — 되살리기</summary>
      <ul className="mt-2 divide-y divide-border">
        {data.projects.map((p) => (
          <li key={p.id} className="flex items-center gap-2 py-1.5">
            <span className="rounded bg-bg px-1.5 text-xs">사업</span>
            <span className="min-w-0 flex-1 truncate">{p.title}</span>
            <span className="text-xs text-muted">{when(p.deleted_at)}</span>
            <button className="inline-flex items-center gap-1 underline" onClick={() => void restore(`/api/projects/${p.id}/restore`, p.title)} aria-label={`되살리기: ${p.title}`}><RotateCcw className="h-3.5 w-3.5" />되살리기</button>
          </li>
        ))}
        {data.tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-2 py-1.5">
            <span className="rounded bg-bg px-1.5 text-xs">업무</span>
            <span className="min-w-0 flex-1 truncate">{t.title}{t.project ? <span className="text-xs text-muted"> · {t.project.title}</span> : null}</span>
            <span className="text-xs text-muted">{when(t.deleted_at)}</span>
            <button className="inline-flex items-center gap-1 underline" onClick={() => void restore(`/api/tasks/${t.id}/restore`, t.title)} aria-label={`되살리기: ${t.title}`}><RotateCcw className="h-3.5 w-3.5" />되살리기</button>
          </li>
        ))}
      </ul>
    </details>
  );
}
