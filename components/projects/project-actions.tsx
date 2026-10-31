"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";

const STATUSES = [["planning", "기획 중"], ["approved", "승인됨"], ["in_progress", "진행 중"], ["done", "완료"], ["postponed", "연기"]];

/** 사업 상태 변경·취소 (취소는 확인 후 실행 — T17) */
export function ProjectActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (status === "cancelled") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="사업 상태"
        className="h-9 w-32"
        value={status}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          try {
            await api(`/api/projects/${id}/status`, { body: { status: e.target.value } });
            router.refresh();
          } catch (err) {
            toast((err as Error).message, { tone: "error" });
          } finally {
            setBusy(false);
          }
        }}
      >
        {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Select>
      <Button
        variant="danger"
        size="sm"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm("사업을 취소할까요?\n미완료 업무는 모두 '취소'되고, 완료 업무·증빙·기록은 보존됩니다.")) return;
          setBusy(true);
          try {
            const r = await api<{ cancelledTasks: number }>(`/api/projects/${id}/cancel`, { body: {} });
            toast(`사업을 취소했습니다. 미완료 업무 ${r.cancelledTasks}건이 취소되었습니다.`);
            router.refresh();
          } catch (err) {
            toast((err as Error).message, { tone: "error" });
          } finally {
            setBusy(false);
          }
        }}
      >
        사업 취소
      </Button>
    </div>
  );
}
