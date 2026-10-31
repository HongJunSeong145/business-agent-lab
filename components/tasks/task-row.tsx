"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Popover } from "radix-ui";
import { ChevronRight, Lock, Paperclip, BookOpen } from "lucide-react";
import { effectiveProgress, progressSource } from "@kgb/rules";
import { DeptChip } from "@/components/dept/dept-chip";
import { ProgressBar } from "@/components/dept/progress-bar";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import type { TaskRowData } from "@/lib/task-rows";
import type { DepartmentCode } from "@/lib/design/tokens";
import { cn, dDayLabel } from "@/lib/utils";

/**
 * 국서 공간 업무 행 (8-6):
 * [완료 체크] 업무명 [협업 국서] 담당자 · 마감 D-n(제안/확정) · [진척도 막대 + %] · [📎] · [레퍼런스] · [›]
 * 완료 체크·진척도는 낙관적 업데이트 후 실패 시 되돌리고 알림.
 */
export function TaskRow({ task, today, deptCode }: { task: TaskRowData; today: string; deptCode: DepartmentCode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [completed, setCompleted] = useState(task.isCompleted);
  const [manual, setManual] = useState<number | null>(task.manualProgress);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(task.effective);

  // 서버 값이 바뀌면(새로고침) 동기화
  const [seen, setSeen] = useState(task);
  if (seen !== task) {
    setSeen(task);
    setCompleted(task.isCompleted);
    setManual(task.manualProgress);
  }

  const state = { is_completed: completed, manual_progress: manual, ai_progress: task.aiProgress };
  const effective = effectiveProgress(state);
  const source = progressSource(state);
  const lead = task.departments.find((d) => d.role === "lead")!;
  const blocked = task.status === "blocked";
  const cancelled = task.status === "cancelled";
  const drawerHref = (() => {
    const q = new URLSearchParams(params);
    q.set("task", task.id);
    return `${pathname}?${q.toString()}`;
  })();

  async function toggleComplete(next: boolean) {
    setCompleted(next);
    setBusy(true);
    try {
      await api(`/api/tasks/${task.id}/complete`, { body: { completed: next } });
      router.refresh();
      if (next) {
        toast(`'${task.title}' 완료 처리했습니다.`, {
          action: { label: "실행 취소", onClick: () => void toggleComplete(false) },
        });
      }
    } catch (e) {
      setCompleted(!next);
      toast((e as Error).message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function saveManual(value: number | null) {
    const prev = manual;
    setManual(value);
    setOpen(false);
    try {
      await api(`/api/tasks/${task.id}/progress`, { body: { value } });
      router.refresh();
    } catch (e) {
      setManual(prev);
      toast((e as Error).message, { tone: "error" });
    }
  }

  return (
    <li
      data-task-id={task.id}
      className={cn(
        "grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2 hover:bg-bg md:grid-cols-[auto_minmax(0,1fr)_auto_auto_11rem_auto]",
        (blocked || cancelled) && "opacity-60",
      )}
    >
      <input
        type="checkbox"
        aria-label={`${task.title} 완료`}
        className="h-4 w-4 accent-[#2E7D4F]"
        checked={completed}
        disabled={busy || !task.can.complete || blocked || cancelled}
        title={!task.can.complete ? "담당자·국장 이상만 완료 체크할 수 있습니다" : blocked ? "선행 업무 대기 중" : undefined}
        onChange={(e) => void toggleComplete(e.target.checked)}
      />
      <div className="min-w-0">
        <Link href={drawerHref} scroll={false} className={cn("block truncate text-sm font-medium hover:underline", (completed || cancelled) && "text-muted line-through")}>
          {task.title}
        </Link>
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
          {task.departments.length > 1 || lead.code !== deptCode
            ? task.departments.map((d) => <DeptChip key={d.code} code={d.code} role={d.role} />)
            : null}
          {blocked ? (
            <span className="inline-flex items-center gap-1 text-muted" data-testid="blocked-reason">
              <Lock className="h-3 w-3" /> {task.blockedReasons.join(", ") || "선행 업무 대기"}
            </span>
          ) : null}
          {task.startedOnDraft && !completed ? <span className="rounded border border-dashed border-warning px-1 text-warning-text">초안 기준</span> : null}
          {cancelled ? <span>취소됨</span> : null}
        </div>
      </div>
      <span className="col-start-2 truncate text-xs text-muted md:col-start-auto md:max-w-32" title={task.assignees.map((a) => a.name).join(", ")}>
        {task.assignees.length ? task.assignees.map((a) => a.name).join(", ") : "담당 미정"}
      </span>
      <span className="col-start-2 text-xs md:col-start-auto">
        {task.due ? (
          <span
            className={cn("tabular rounded px-1.5 py-0.5", task.dueState === "proposed" ? "border border-dashed border-border" : "border border-transparent", !completed && task.due < today && "border-danger text-danger")}
            title={`${task.due} ${task.dueState === "proposed" ? "(AI·규칙 제안)" : "(확정)"}${task.dueReason ? ` — ${task.dueReason}` : ""}`}
          >
            {dDayLabel(task.due, today)} <span className="text-muted">{task.dueState === "proposed" ? "제안" : "확정"}</span>
          </span>
        ) : (
          <span className="text-muted">마감 없음</span>
        )}
      </span>
      <Popover.Root open={open} onOpenChange={(o) => (setOpen(o), o && setDraft(effective))}>
        <Popover.Trigger asChild disabled={!task.can.progress || completed || cancelled}>
          <button className="col-start-2 w-full text-left disabled:cursor-default md:col-start-auto" aria-label={`${task.title} 진척도 ${effective}% 조정`}>
            <ProgressBar code={lead.code} value={effective} source={source} label={`${task.title} 진척도`} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content sideOffset={6} className="z-50 w-64 rounded-lg border border-border bg-surface p-4 shadow-lg">
            <label className="mb-2 block text-sm font-medium" htmlFor={`range-${task.id}`}>진척도 직접 조정</label>
            <div className="flex items-center gap-2">
              <input id={`range-${task.id}`} type="range" min={0} max={100} step={5} value={draft} onChange={(e) => setDraft(Number(e.target.value))} className="flex-1" />
              <span className="tabular w-10 text-right text-sm">{draft}%</span>
            </div>
            <div className="mt-3 flex justify-between gap-2">
              <button className="text-xs text-muted underline disabled:opacity-40" disabled={manual === null} onClick={() => void saveManual(null)}>
                AI 평가로 되돌리기
              </button>
              <button className="rounded-md bg-text px-3 py-1 text-xs font-medium text-white" onClick={() => void saveManual(draft)}>진척도 적용</button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <span className="col-start-2 flex items-center gap-1 justify-self-end md:col-start-auto">
        <span className="inline-flex h-7 w-7 cursor-not-allowed items-center justify-center rounded text-muted opacity-50" title="작업물 업로드 — Phase 6 예정" aria-label="작업물 업로드(Phase 6 예정)"><Paperclip className="h-4 w-4" /></span>
        <span className="inline-flex h-7 w-7 cursor-not-allowed items-center justify-center rounded text-muted opacity-50" title="레퍼런스 — Phase 7 예정" aria-label="레퍼런스(Phase 7 예정)"><BookOpen className="h-4 w-4" /></span>
        <Link href={drawerHref} scroll={false} className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-surface" aria-label={`${task.title} 상세`}><ChevronRight className="h-4 w-4" /></Link>
      </span>
    </li>
  );
}

