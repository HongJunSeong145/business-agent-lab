"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Flag } from "lucide-react";
import { DeptChip } from "@/components/dept/dept-chip";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import type { DepartmentCode } from "@/lib/design/tokens";
import { cn, dDayLabel, formatKoreanDate } from "@/lib/utils";

export type UpcomingItem = {
  id: string;
  kind: "deadline" | "milestone" | "proposal";
  title: string;
  due: string;
  dueState: "proposed" | "confirmed";
  leadCode: DepartmentCode | null;
  assignees: string[];
  feasible: boolean;
  projectTitle: string | null;
};

/** 향후 30일 세부 일정 (8-2 ②): 날짜별, 제안/확정 구분, 제안 항목 옆 '확정', 날짜 바로 수정 */
export function UpcomingList({ items, today, canEdit }: { items: UpcomingItem[]; today: string; canEdit: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [editing, setEditing] = useState<string | null>(null);

  const href = (id: string) => {
    const q = new URLSearchParams(params);
    q.set("task", id);
    return `${pathname}?${q.toString()}`;
  };
  const patch = async (id: string, body: object, ok: string) => {
    try {
      await api(`/api/tasks/${id}`, { method: "PATCH", body });
      toast(ok);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    }
  };

  const days = [...new Set(items.map((i) => i.due))];
  return (
    <div className="space-y-3" data-testid="upcoming-list">
      {days.map((d) => (
        <section key={d} aria-label={formatKoreanDate(d)}>
          <h3 className="mb-1 flex items-center justify-between text-xs font-semibold text-muted">
            <span>{formatKoreanDate(d)}</span>
            <span className="tabular">{dDayLabel(d, today)}</span>
          </h3>
          <ul className="space-y-1">
            {items.filter((i) => i.due === d).map((i) => (
              <li key={i.id} className={cn("rounded-lg px-2 py-1.5 text-sm", i.dueState === "proposed" ? "border border-dashed border-border" : "border border-transparent bg-bg/50")} data-upcoming={i.title}>
                <div className="flex items-center gap-1.5">
                  {i.kind === "milestone" ? <Flag aria-label="마일스톤" className="h-3.5 w-3.5 shrink-0 text-info" /> : i.leadCode ? <DeptChip code={i.leadCode} /> : null}
                  {!i.feasible ? <AlertTriangle aria-label="일정 불가" className="h-3.5 w-3.5 shrink-0 text-danger" /> : null}
                  {i.kind === "deadline" ? (
                    <Link href={href(i.id)} scroll={false} className="min-w-0 flex-1 truncate hover:underline">{i.title}</Link>
                  ) : i.kind === "proposal" ? (
                    <span className="min-w-0 flex-1 truncate text-muted">
                      {i.title} <span className="rounded border border-dashed border-border px-1 text-[10px]">AI 제안</span>{" "}
                      {canEdit ? <Link href="/review" className="text-xs text-text underline">검토</Link> : null}
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{i.title}{i.projectTitle ? <span className="text-muted"> · {i.projectTitle}</span> : null}</span>
                  )}
                </div>
                {i.kind === "deadline" ? (
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 pl-0.5 text-xs text-muted">
                    <span>{i.assignees.length ? i.assignees.join(", ") : "담당 미정"}</span>
                    <span className={cn("rounded px-1", i.dueState === "proposed" ? "border border-dashed border-border" : "border border-border")}>{i.dueState === "proposed" ? "AI·규칙 제안" : "확정"}</span>
                    {canEdit && editing === i.id ? (
                      <input
                        type="date"
                        autoFocus
                        aria-label={`${i.title} 마감 수정`}
                        defaultValue={i.due}
                        className="h-7 rounded border border-border px-1 text-xs"
                        onBlur={(e) => {
                          setEditing(null);
                          if (e.target.value && e.target.value !== i.due) void patch(i.id, { due_date: e.target.value }, "마감을 바꿨습니다(확정).");
                        }}
                        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
                      />
                    ) : canEdit ? (
                      <button className="underline" onClick={() => setEditing(i.id)}>날짜 수정</button>
                    ) : null}
                    {canEdit && i.dueState === "proposed" ? (
                      <button className="font-medium text-text underline" onClick={() => void patch(i.id, { due_state: "confirmed" }, "마감을 확정했습니다.")} aria-label={`${i.title} 마감 확정`}>
                        승인
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
