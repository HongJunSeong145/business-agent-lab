"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { api } from "@/lib/client-api";
import { DEPARTMENTS, type DepartmentCode } from "@/lib/design/tokens";

type Item = { deliverableId: string; title: string; taskId: string; taskTitle: string; taskDone: boolean; isFinal: boolean; versionNo: number; versions: number; fileName: string | null; externalUrl: string | null; preview: string; url: string | null; downloadUrl: string | null; at: string };
type Data = { status: string; groups: { code: DepartmentCode; name: string; items: Item[] }[] };

/** 사업 작업물 보관함: 국서별 최종본(없으면 최신 버전) — 완료된 사업의 결과물 보관 */
export function ArchivePanel({ projectId }: { projectId: string }) {
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => {
    let c = false;
    api<Data>(`/api/projects/${projectId}/archive`).then((r) => !c && setD(r)).catch(() => undefined);
    return () => {
      c = true;
    };
  }, [projectId]);
  if (!d) return <div className="h-16 animate-pulse rounded-lg bg-bg" aria-busy="true" />;
  if (!d.groups.length) return <p className="text-sm text-muted">아직 올린 작업물이 없습니다. 각 업무의 &lsquo;작업물&rsquo; 탭에서 올리면 여기에 국서별로 모입니다.</p>;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="archive">
      {d.groups.map((g) => (
        <section key={g.code} aria-label={`${g.name} 작업물`} className="rounded-lg border border-border">
          <h3 className="rounded-t-lg px-3 py-2 text-sm font-semibold" style={{ backgroundColor: DEPARTMENTS[g.code].chipBg, color: DEPARTMENTS[g.code].ink }}>{g.name} <span className="font-normal">({g.items.length})</span></h3>
          <ul className="divide-y divide-border">
            {g.items.map((i) => (
              <li key={i.deliverableId} className="flex items-start gap-2 px-3 py-2 text-sm">
                {i.preview === "image" && i.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{i.title} {i.isFinal ? <span className="ml-1 rounded border border-success px-1 text-xs text-success">최종본</span> : <span className="ml-1 text-xs text-muted">최신 v{i.versionNo}</span>}</p>
                  <a href={`?task=${i.taskId}&tab=deliverables`} className="block truncate text-xs text-muted underline">{i.taskTitle}{i.taskDone ? " · 완료" : ""}</a>
                </div>
                {i.downloadUrl ? <a href={i.downloadUrl} aria-label={`내려받기: ${i.title}`} className="text-muted hover:text-text"><Download className="h-4 w-4" /></a> : null}
                {i.externalUrl ? <a href={i.externalUrl} target="_blank" rel="noopener noreferrer" aria-label={`링크 열기: ${i.title}`} className="text-muted hover:text-text"><ExternalLink className="h-4 w-4" /></a> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
