"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";

/** 행사일 미정 사업: 회의록에 행사일이 없어 마감을 계산하지 못한 경우 — 지금 입력하거나 나중에 입력 */
export function EventDateSetter({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning bg-[#FFF8E6] px-3 py-2 text-sm" role="status" data-testid="event-date-missing">
      <CalendarClock className="h-4 w-4 shrink-0 text-warning-text" />
      <span className="flex-1">
        <strong>행사일 미정</strong> — 회의록에 행사 당일 날짜가 없습니다. 행사일을 넣으면 표준 업무의 마감이 자동으로 계산됩니다(지금 정하지 않아도 됩니다).
      </span>
      {canEdit ? (
        <form
          className="flex items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!date) return;
            setBusy(true);
            try {
              await api(`/api/projects/${projectId}/dates`, { method: "PATCH", body: { event_start: date } });
              toast("행사일을 넣고 마감을 계산했습니다.");
              router.refresh();
            } catch (err) {
              toast((err as Error).message, { tone: "error" });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Input type="date" aria-label="행사 당일 날짜" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-40" required />
          <Button size="sm" disabled={busy || !date}>행사일 저장</Button>
        </form>
      ) : <span className="text-xs text-muted">회장·국장이 입력합니다</span>}
    </div>
  );
}
