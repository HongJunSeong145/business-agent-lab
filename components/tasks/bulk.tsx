"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";
import { ListChecks, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { useOptions } from "./use-options";

type Ctx = { active: boolean; selected: Set<string>; toggle: (id: string) => void };
const BulkCtx = createContext<Ctx>({ active: false, selected: new Set(), toggle: () => undefined });
export const useBulk = () => useContext(BulkCtx);

/** 국서 공간 일괄 수정: '여러 업무 선택'을 켜면 행마다 선택 칸이 생기고, 아래 막대에서 한 번에 바꾼다 */
export function BulkProvider({ children, canManage }: { children: React.ReactNode; canManage: boolean }) {
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState("due");
  const [date, setDate] = useState("");
  const [days, setDays] = useState(1);
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const { data } = useOptions(active && canManage);
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const apply = async () => {
    if (action === "delete" && !window.confirm(`선택한 업무 ${selected.size}개를 삭제할까요?`)) return;
    setBusy(true);
    try {
      const r = await api<{ done: number; failed: { id: string; error?: string }[] }>("/api/tasks/bulk", {
        body: { ids: [...selected], action, due_date: date || undefined, days, assignee_ids: assignee ? [assignee] : [] },
      });
      toast(`${r.done}개 처리했습니다.${r.failed.length ? ` ${r.failed.length}개는 못 했습니다(${[...new Set(r.failed.map((f) => f.error))].join(", ")}).` : ""}`, { tone: r.failed.length ? "error" : undefined });
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <BulkCtx.Provider value={{ active, selected, toggle }}>
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={() => (setActive(!active), setSelected(new Set()))} aria-pressed={active}>
          <ListChecks className="h-4 w-4" /> {active ? "선택 끝내기" : "여러 업무 선택(일괄 수정)"}
        </Button>
      </div>
      {children}
      {active ? (
        <div className="sticky bottom-3 z-30 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-lg" role="region" aria-label="일괄 수정">
          <strong className="text-sm">{selected.size}개 선택</strong>
          <Select aria-label="일괄 작업" value={action} onChange={(e) => setAction(e.target.value)} className="h-8 w-44">
            {canManage ? <option value="due">마감 날짜 지정</option> : null}
            {canManage ? <option value="shift">마감 며칠 옮기기</option> : null}
            {canManage ? <option value="assign">담당자 지정</option> : null}
            <option value="complete">완료 처리</option>
            <option value="uncomplete">완료 해제</option>
            {canManage ? <option value="cancel">취소</option> : null}
            {canManage ? <option value="reopen">취소 되살리기</option> : null}
            {canManage ? <option value="delete">삭제</option> : null}
          </Select>
          {action === "due" ? <Input type="date" aria-label="일괄 마감 날짜" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-40" /> : null}
          {action === "shift" ? <Input type="number" aria-label="옮길 날 수" value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-8 w-20" title="음수면 앞당김" /> : null}
          {action === "assign" ? (
            <Select aria-label="일괄 담당자" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-8 w-40">
              <option value="">담당자 비우기</option>
              {data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          ) : null}
          <Button size="sm" disabled={busy || selected.size === 0 || (action === "due" && !date)} onClick={() => void apply()}>적용</Button>
          <button className="ml-auto text-muted" aria-label="선택 끝내기" onClick={() => (setActive(false), setSelected(new Set()))}><X className="h-4 w-4" /></button>
        </div>
      ) : null}
    </BulkCtx.Provider>
  );
}

/** 업무 행의 선택 칸 (일괄 수정 모드에서만) */
export function BulkSelect({ id, title }: { id: string; title: string }) {
  const { active, selected, toggle } = useBulk();
  if (!active) return null;
  return <input type="checkbox" className="h-4 w-4 accent-[#3B5B7A]" aria-label={`${title} 선택(일괄 수정)`} checked={selected.has(id)} onChange={() => toggle(id)} />;
}
