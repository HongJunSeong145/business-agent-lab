"use client";

import { api } from "@/lib/client-api";
import { toast } from "@/components/ui/toast";
import { emitChanged } from "@/components/layout/live-refresh";

/**
 * 업무 바로 삭제 + '되돌리기'. 삭제·되살리기 모두 연결된 것(선후관계·차단·대기 제안·사업 완료·진척도·캘린더)을 함께 정리한다.
 * ask=false 면 확인 창 없이 바로(되돌리기 버튼이 있으므로).
 */
export async function deleteTaskWithUndo(id: string, title: string, refresh: () => void, opts: { ask?: boolean } = {}) {
  if (opts.ask && !window.confirm(`'${title}' 업무를 삭제할까요? 후속 업무의 선행 관계도 함께 풀립니다.`)) return false;
  try {
    await api(`/api/tasks/${id}`, { method: "DELETE" });
  } catch (e) {
    toast((e as Error).message, { tone: "error" });
    return false;
  }
  refresh();
  emitChanged();
  toast(`'${title}' 업무를 삭제했습니다.`, {
    ms: 10000,
    action: {
      label: "되돌리기",
      onClick: () =>
        void api(`/api/tasks/${id}/restore`, { body: {} })
          .then(() => (refresh(), emitChanged(), toast(`'${title}' 업무를 되살렸습니다.`)))
          .catch((e: Error) => toast(e.message, { tone: "error" })),
    },
  });
  return true;
}
