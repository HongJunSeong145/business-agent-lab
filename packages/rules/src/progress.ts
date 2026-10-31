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

/**
 * 사업 진척도 (D4, 8-2 ③):
 *  - 국서 가중치 기본값 = 그 국서가 주관(lead)하는 업무 weight 합 / 사업 전체 weight 합
 *  - 국서 진척 = 주관 업무 effective 의 weight 가중 평균
 *  - 사업 % = Σ 국서 가중치 × 국서 진척
 *  - 협조 업무는 주관 국서에만 집계, 취소 업무는 제외
 *  - 회장 덮어쓰기(override): 업무가 있는 국서들 사이에서 비율로 정규화. 업무 없는 국서의 값은 무시(목록 반환)
 */
export type ProgressTask = { weight: number; effective: number; leadCode: string; status: string };

export type DeptSegment = { code: string; share: number; progress: number; taskCount: number };

export type ProjectProgress = { total: number; segments: DeptSegment[]; overrideIgnored: string[] };

export function projectProgress(
  tasks: readonly ProgressTask[],
  deptOrder: readonly string[],
  override?: Readonly<Record<string, number>> | null,
): ProjectProgress {
  const active = tasks.filter((t) => t.status !== "cancelled" && t.weight > 0);
  const stats = new Map<string, { w: number; we: number; n: number }>();
  for (const t of active) {
    const s = stats.get(t.leadCode) ?? { w: 0, we: 0, n: 0 };
    s.w += t.weight;
    s.we += t.weight * t.effective;
    s.n += 1;
    stats.set(t.leadCode, s);
  }
  const totalW = [...stats.values()].reduce((a, s) => a + s.w, 0);

  const overrideIgnored: string[] = [];
  let shares: Map<string, number> | null = null;
  if (override) {
    const usable = new Map<string, number>();
    for (const [code, v] of Object.entries(override)) {
      if (!(v > 0)) continue;
      if (stats.has(code)) usable.set(code, v);
      else overrideIgnored.push(code);
    }
    const sum = [...usable.values()].reduce((a, v) => a + v, 0);
    if (sum > 0) shares = new Map([...usable].map(([c, v]) => [c, v / sum]));
  }

  const segments: DeptSegment[] = deptOrder.map((code) => {
    const s = stats.get(code);
    const progress = s ? s.we / s.w : 0;
    const share = shares ? (shares.get(code) ?? 0) : s && totalW > 0 ? s.w / totalW : 0;
    return { code, share, progress, taskCount: s?.n ?? 0 };
  });
  const total = segments.reduce((a, s) => a + s.share * s.progress, 0);
  return { total, segments, overrideIgnored };
}
