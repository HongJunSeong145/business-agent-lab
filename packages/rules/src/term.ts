import { addDays } from "./dates";
import type { TermQuarters } from "./quarters";

/**
 * 학사일정으로 분기 날짜 자동 계산 (D5, 5-5) — 결과는 설정 화면에서 수정 가능.
 *  1분기: 중앙선거 종료 ~ 1학기 개강 전날 / 2분기: 1학기 개강 ~ 종강 / 3분기: 여름방학 / 4분기: 2학기 개강 ~ 다음 선거 확정
 */
export type AcademicCalendar = { electionEnd: string; sem1Start: string; sem1End: string; sem2Start: string; nextElectionEnd: string };

export function quartersFromAcademicCalendar(c: AcademicCalendar): TermQuarters {
  const order = [c.electionEnd, c.sem1Start, c.sem1End, c.sem2Start, c.nextElectionEnd];
  for (let i = 1; i < order.length; i++) {
    if (!(order[i - 1]! < order[i]!)) throw new Error("학사일정 순서가 올바르지 않습니다(선거 종료 < 1학기 개강 < 1학기 종강 < 2학기 개강 < 다음 선거).");
  }
  if (addDays(c.sem1End, 1) > addDays(c.sem2Start, -1)) throw new Error("여름방학(3분기)이 비어 있습니다.");
  return {
    q1_start: c.electionEnd, q1_end: addDays(c.sem1Start, -1),
    q2_start: c.sem1Start, q2_end: c.sem1End,
    q3_start: addDays(c.sem1End, 1), q3_end: addDays(c.sem2Start, -1),
    q4_start: c.sem2Start, q4_end: c.nextElectionEnd,
  };
}
