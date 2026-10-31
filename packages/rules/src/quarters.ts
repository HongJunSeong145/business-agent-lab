/**
 * 분기 판정 (지시서 5-5, D5). 분기 경계는 기수 설정값(날짜)으로만 판단 — 하드코딩 금지.
 * 날짜는 'YYYY-MM-DD' 문자열(사전순 비교 = 날짜순 비교) — ADR-009.
 */
export type Quarter = 1 | 2 | 3 | 4;

export type TermQuarters = {
  q1_start: string; q1_end: string;
  q2_start: string; q2_end: string;
  q3_start: string; q3_end: string;
  q4_start: string; q4_end: string;
};

export function quarterOf(term: TermQuarters, date: string): Quarter | null {
  const ranges: [Quarter, string, string][] = [
    [1, term.q1_start, term.q1_end],
    [2, term.q2_start, term.q2_end],
    [3, term.q3_start, term.q3_end],
    [4, term.q4_start, term.q4_end],
  ];
  for (const [q, s, e] of ranges) if (date >= s && date <= e) return q;
  return null;
}

/** 대시보드 기본 분기: 오늘이 속한 분기, 기수 밖이면 가장 가까운 분기 */
export function defaultQuarter(term: TermQuarters, today: string): Quarter {
  const q = quarterOf(term, today);
  if (q) return q;
  if (today < term.q1_start) return 1;
  if (today > term.q4_end) return 4;
  // 분기 사이의 빈 날(설정 실수 등): 다음 분기
  if (today < term.q2_start) return 2;
  if (today < term.q3_start) return 3;
  return 4;
}

/** 예결산 심사 묶음: 1·2분기 = A, 3·4분기 = B */
export function reviewGroup(q: Quarter): "A" | "B" {
  return q <= 2 ? "A" : "B";
}
