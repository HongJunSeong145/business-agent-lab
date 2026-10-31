"use client";

import { Dialog } from "radix-ui";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label, Select } from "@/components/ui/field";
import { api } from "@/lib/client-api";
import { useOptions } from "./use-options";

const DEP_TYPES = [
  { value: "finish_to_start", label: "완료 후 착수" },
  { value: "approval_required", label: "결재 후 착수" },
  { value: "draft_ok", label: "초안 있으면 착수" },
];

/** 업무 직접 추가 (D1: 국장 이상이 직접 만들면 바로 확정) */
export function TaskFormDialog({
  trigger,
  defaultProjectId,
  defaultLeadDepartmentId,
}: {
  trigger: React.ReactNode;
  defaultProjectId?: string | null;
  defaultLeadDepartmentId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data, error: loadError } = useOptions(open);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [lead, setLead] = useState(defaultLeadDepartmentId ?? "");
  const [support, setSupport] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [deps, setDeps] = useState<{ depends_on_task_id: string; type: string }[]>([]);
  const [depPick, setDepPick] = useState({ id: "", type: "finish_to_start" });

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    setPending(true);
    try {
      await api("/api/tasks", {
        body: {
          title: fd.get("title"),
          description: String(fd.get("description") ?? "") || null,
          project_id: String(fd.get("project_id") ?? "") || null,
          lead_department_id: lead,
          support_department_ids: support.filter((s) => s !== lead),
          assignee_ids: assignees,
          due_date: String(fd.get("due_date") ?? ""),
          weight: Number(fd.get("weight") ?? 1),
          acceptance_criteria: String(fd.get("criteria") ?? "")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((text) => ({ text, done: false })),
          dependencies: deps,
        },
      });
      setOpen(false);
      setSupport([]);
      setAssignees([]);
      setDeps([]);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl focus:outline-none">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">업무 추가</Dialog.Title>
            <Dialog.Close className="rounded-md p-1 hover:bg-bg" aria-label="닫기"><X className="h-5 w-5" /></Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">업무 정보를 입력합니다.</Dialog.Description>
          {loadError ? <FormMessage>{loadError}</FormMessage> : null}
          {!data ? (
            <p className="text-sm text-muted" aria-busy="true">불러오는 중…</p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <Label htmlFor="task-title">업무명</Label>
                <Input id="task-title" name="title" required maxLength={150} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="task-project">사업</Label>
                  <Select id="task-project" name="project_id" defaultValue={defaultProjectId ?? ""}>
                    <option value="">사업 외 업무</option>
                    {data.projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="task-lead">주관 국서</Label>
                  <Select id="task-lead" required value={lead} onChange={(e) => setLead(e.target.value)}>
                    <option value="">선택</option>
                    {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name_ko}</option>)}
                  </Select>
                </div>
              </div>
              <fieldset>
                <legend className="mb-1 text-sm font-medium">협조 국서</legend>
                <div className="flex flex-wrap gap-3">
                  {data.departments.filter((d) => d.id !== lead).map((d) => (
                    <label key={d.id} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={support.includes(d.id)} onChange={() => setSupport(toggle(support, d.id))} /> {d.name_ko}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-1 text-sm font-medium">담당자</legend>
                <div className="grid max-h-36 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-3">
                  {data.members.map((m) => (
                    <label key={m.id} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={assignees.includes(m.id)} onChange={() => setAssignees(toggle(assignees, m.id))} />
                      <span className="truncate">{m.name}{m.dept ? <span className="text-muted"> · {m.dept}</span> : null}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="task-due">마감일</Label>
                  <Input id="task-due" name="due_date" type="date" />
                </div>
                <div>
                  <Label htmlFor="task-weight">가중치 (기본 1)</Label>
                  <Input id="task-weight" name="weight" type="number" min={0.5} max={100} step={0.5} defaultValue={1} />
                </div>
              </div>
              <div>
                <Label htmlFor="task-desc">설명</Label>
                <textarea id="task-desc" name="description" rows={3} className="w-full rounded-lg border border-border p-2 text-sm" />
              </div>
              <div>
                <Label htmlFor="task-criteria">완료 기준 (한 줄에 하나)</Label>
                <textarea id="task-criteria" name="criteria" rows={3} className="w-full rounded-lg border border-border p-2 text-sm" placeholder={"예) 행사 일시·장소 포함\n예) 4장 이상"} />
              </div>
              <fieldset>
                <legend className="mb-1 text-sm font-medium">선행 업무</legend>
                {deps.length ? (
                  <ul className="mb-2 space-y-1 text-sm">
                    {deps.map((d, i) => (
                      <li key={d.depends_on_task_id} className="flex items-center justify-between rounded bg-bg px-2 py-1">
                        <span>{data.tasks.find((t) => t.id === d.depends_on_task_id)?.title} · {DEP_TYPES.find((x) => x.value === d.type)?.label}</span>
                        <button type="button" aria-label="선행 업무 빼기" onClick={() => setDeps(deps.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex gap-2">
                  <Select aria-label="선행 업무 선택" value={depPick.id} onChange={(e) => setDepPick({ ...depPick, id: e.target.value })}>
                    <option value="">선행 업무 선택</option>
                    {data.tasks.filter((t) => !deps.some((d) => d.depends_on_task_id === t.id)).map((t) => (
                      <option key={t.id} value={t.id}>{t.title}{t.project ? ` (${t.project})` : ""}</option>
                    ))}
                  </Select>
                  <Select aria-label="의존 유형" value={depPick.type} onChange={(e) => setDepPick({ ...depPick, type: e.target.value })} className="w-44 shrink-0">
                    {DEP_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Select>
                  <Button type="button" variant="secondary" disabled={!depPick.id} onClick={() => (setDeps([...deps, { depends_on_task_id: depPick.id, type: depPick.type }]), setDepPick({ ...depPick, id: "" }))}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </fieldset>
              <FormMessage>{error}</FormMessage>
              <div className="flex justify-end gap-2">
                <Dialog.Close asChild><Button type="button" variant="secondary">취소</Button></Dialog.Close>
                <Button type="submit" disabled={pending}>{pending ? "추가 중…" : "업무 추가"}</Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
