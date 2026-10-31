import { addDays, weekday } from "@kgb/rules";

/**
 * 회의록의 한국어 날짜 표현 해석 (A1 예외 처리 6-2: 상대 표현은 회의일 기준, 확신도 낮춤).
 * mock 분석기와 AI 결과 보정에 함께 쓴다.
 */
export type ParsedDate = { text: string; date: string; confidence: "high" | "medium" | "low" };

const WD: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const pad = (n: number) => String(n).padStart(2, "0");

/** 연도 없는 월·일 → 회의일 이후 가장 가까운 날짜 */
export function resolveMonthDay(month: number, day: number, meetingDate: string): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const y = Number(meetingDate.slice(0, 4));
  let d = `${y}-${pad(month)}-${pad(day)}`;
  if (d < addDays(meetingDate, -7)) d = `${y + 1}-${pad(month)}-${pad(day)}`;
  return d;
}

export function parseKoreanDates(text: string, meetingDate: string): ParsedDate[] {
  const out: ParsedDate[] = [];
  const full = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g;
  for (const m of text.matchAll(full)) out.push({ text: m[0], date: `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`, confidence: "high" });
  const md = /(?<!\d년\s*)(?<!\d)(\d{1,2})월\s*(\d{1,2})일/g;
  for (const m of text.matchAll(md)) {
    if (out.some((o) => o.text.includes(m[0]))) continue;
    const d = resolveMonthDay(Number(m[1]), Number(m[2]), meetingDate);
    if (d) out.push({ text: m[0], date: d, confidence: "medium" });
  }
  const dot = /(?<![\d.])(\d{1,2})\.\s*(\d{1,2})\s*\(([월화수목금토일])\)/g;
  for (const m of text.matchAll(dot)) {
    const d = resolveMonthDay(Number(m[1]), Number(m[2]), meetingDate);
    if (d) out.push({ text: m[0], date: d, confidence: "medium" });
  }
  const rel = /(다음\s*주|이번\s*주|차주|금주)?\s*([월화수목금토일])요일/g;
  for (const m of text.matchAll(rel)) {
    const target = WD[m[2]!]!;
    const base = weekday(meetingDate);
    let delta = (target - base + 7) % 7;
    if (m[1] && /다음|차주/.test(m[1])) delta = 7 - base + target; // 다음 주(월~일 기준) 해당 요일
    if (delta === 0 && !m[1]) delta = 7;
    out.push({ text: m[0].trim(), date: addDays(meetingDate, delta), confidence: "low" });
  }
  return out;
}
