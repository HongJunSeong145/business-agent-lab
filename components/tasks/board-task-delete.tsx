"use client";

import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { deleteTaskWithUndo } from "./task-actions";

/** 사업 보드 카드의 바로 삭제(되돌리기 가능) */
export function BoardTaskDelete({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="absolute top-1 right-1 rounded p-0.5 text-muted opacity-60 hover:text-danger hover:opacity-100"
      aria-label={`${title} 삭제`}
      title="삭제(되돌리기 가능)"
      onClick={() => void deleteTaskWithUndo(id, title, () => router.refresh())}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}
