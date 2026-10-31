/**
 * 진척도 계산 (지시서 D3·D4). 순수 함수 — DB/시계 의존 없음.
 */

export type ProgressInput = {
  is_completed: boolean;
  manual_progress: number | null;
  ai_progress: number | null;
};

/** D3: effective = 완료 ? 100 : (수동 ?? AI ?? 0). DB 뷰 task_progress 와 같은 공식. */
export function effectiveProgress(t: ProgressInput): number {
  if (t.is_completed) return 100;
  return t.manual_progress ?? t.ai_progress ?? 0;
}

/** 진척도 표식(9-3): 완료 > 수동 > AI > 없음 */
export type ProgressSource = "completed" | "manual" | "ai" | "none";

export function progressSource(t: ProgressInput): ProgressSource {
  if (t.is_completed) return "completed";
  if (t.manual_progress !== null) return "manual";
  if (t.ai_progress !== null) return "ai";
  return "none";
}
