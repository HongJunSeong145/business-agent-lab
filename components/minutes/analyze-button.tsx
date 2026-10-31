"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";

/** AI 분석 / 재분석 (8-3): 재분석이면 확인 — 기존 대기 제안은 새 제안으로 대체된다 */
export function AnalyzeButton({ meetingId, reanalyze }: { meetingId: string; reanalyze: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await api(`/api/meetings/${meetingId}/analyze`, { body: {} });
      toast("AI 분석을 시작했습니다. 끝나면 '검토 대기'로 알려 드립니다.");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size="sm" variant={reanalyze ? "secondary" : "primary"} disabled={busy} onClick={() => (reanalyze ? setOpen(true) : void go())}>
        <Sparkles className="h-4 w-4" /> {reanalyze ? "재분석" : "AI 분석 시작"}
      </Button>
      <ConfirmDialog
        open={open}
        title="회의록을 다시 분석할까요?"
        description="새 정리본 버전이 만들어지고, 아직 처리하지 않은 AI 제안은 새 제안으로 대체됩니다. 이미 승인한 항목은 바뀌지 않습니다."
        confirmLabel="재분석"
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          void go();
        }}
      />
    </>
  );
}
