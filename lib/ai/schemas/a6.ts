import { z } from "zod";

/** A6 작업물 평가 (6-2 A6): 기준별 충족/부분/미충족 + 근거 → 점수 1~100 → 부족 항목·개선 제안 */
export const a6Schema = z.object({
  criteria: z
    .array(
      z.object({
        criterion: z.string().min(1).max(200),
        verdict: z.enum(["met", "partial", "unmet"]),
        evidence: z.string().max(400),
      }),
    )
    .min(1)
    .max(20),
  score: z.number().int().min(1).max(100),
  missing_items: z.array(z.string().max(200)).max(10),
  suggestions: z.array(z.string().max(300)).max(10),
  summary: z.string().max(400),
});
export type A6Output = z.infer<typeof a6Schema>;

export const VERDICT_LABEL: Record<A6Output["criteria"][number]["verdict"], string> = { met: "충족", partial: "부분", unmet: "미충족" };

/** 기준 판정으로 계산한 점수 범위 — AI 점수가 판정과 크게 어긋나면 이 범위로 맞춘다(같은 판정 → 비슷한 점수) */
export function scoreBounds(criteria: A6Output["criteria"]): [number, number] {
  const n = criteria.length;
  const pts = criteria.reduce((s, c) => s + (c.verdict === "met" ? 1 : c.verdict === "partial" ? 0.5 : 0), 0);
  const ratio = pts / n;
  const lo = Math.max(1, Math.round(ratio * 100 - 20));
  const hi = Math.min(100, Math.round(ratio * 100 + 15));
  return [lo, Math.max(lo, hi)];
}

export function normalizeScore(out: A6Output): number {
  const [lo, hi] = scoreBounds(out.criteria);
  return Math.min(hi, Math.max(lo, out.score));
}
