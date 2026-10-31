"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";

/** 회의록 삭제 — 잘못 올린 회의록 정리용. 처리 전 AI 제안도 함께 빠진다 */
export function DeleteMeetingButton({ meetingId, title }: { meetingId: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" className="text-danger" onClick={() => setOpen(true)}>
        <Trash2 className="h-4 w-4" /> 회의록 삭제
      </Button>
      <ConfirmDialog
        open={open}
        title="이 회의록을 삭제할까요?"
        description={`'${title}'과 아직 처리하지 않은 AI 제안이 목록에서 사라집니다. 이미 승인해 만든 사업·업무는 그대로 남습니다(필요하면 업무 화면에서 따로 취소·삭제하세요).`}
        confirmLabel="삭제"
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          setOpen(false);
          try {
            const r = await api<{ removedProposals: number }>(`/api/meetings/${meetingId}`, { method: "DELETE" });
            toast(`회의록을 삭제했습니다.${r.removedProposals ? ` 대기 중이던 제안 ${r.removedProposals}건도 정리했습니다.` : ""}`);
            router.push("/minutes");
            router.refresh();
          } catch (e) {
            toast((e as Error).message, { tone: "error" });
          }
        }}
      />
    </>
  );
}
