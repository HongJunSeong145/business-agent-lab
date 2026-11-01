/**
 * 회의록 원문 문단 분할 — 빈 줄이 아닌 줄 하나 = 문단 하나(1부터 번호).
 * A1 분석의 "원문 위치(문단 인덱스)"가 이 번호를 기준으로 한다(Phase 5).
 */
export function toParagraphs(text: string): { n: number; text: string }[] {
  return text
    .split("\n")
    .map((t) => t.trimEnd())
    .filter((t) => t.trim().length > 0)
    .map((t, i) => ({ n: i + 1, text: t }));
}
