"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { Trash2 } from "lucide-react";
import { emitChanged } from "@/components/layout/live-refresh";

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

/** 사업 삭제(업무 함께) — 바로 삭제하고 '되돌리기' 제공. 취소된 사업도 지울 수 있다 */
export function ProjectDeleteButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-danger"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm(`'${title}' 사업을 삭제할까요?\n이 사업의 업무와 대기 중인 제안도 함께 정리됩니다. 사업 목록의 '최근 삭제'에서 되살릴 수 있습니다.`)) return;
        setBusy(true);
        try {
          const r = await api<{ deletedTasks: number }>(`/api/projects/${id}`, { method: "DELETE" });
          emitChanged();
          toast(`'${title}' 사업과 업무 ${r.deletedTasks}건을 삭제했습니다.`, {
            ms: 10000,
            action: {
              label: "되돌리기",
              onClick: () =>
                void api(`/api/projects/${id}/restore`, { body: {} })
                  .then(() => (router.push(`/projects/${id}`), emitChanged(), toast("사업을 되살렸습니다.")))
                  .catch((e: Error) => toast(e.message, { tone: "error" })),
            },
          });
          router.push("/projects");
          router.refresh();
        } catch (err) {
          toast((err as Error).message, { tone: "error" });
          setBusy(false);
        }
      }}
    >
      <Trash2 className="h-4 w-4" /> 사업 삭제
    </Button>
  );
}
