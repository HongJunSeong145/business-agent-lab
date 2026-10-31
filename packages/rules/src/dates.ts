/**
 * 날짜 계산 (ADR-009): 'YYYY-MM-DD' ↔ 에포크 일수 정수. 시간대 개념 없음.
 */
const DAY = 86_400_000;

export function toDays(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / DAY);
}

export function fromDays(days: number): string {
  return new Date(days * DAY).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return fromDays(toDays(iso) + n);
}

/** 0=일 … 6=토 */
export function weekday(iso: string): number {
  return new Date(toDays(iso) * DAY).getUTCDay();
}

export function isOffDay(iso: string, holidays: ReadonlySet<string>): boolean {
  const w = weekday(iso);
  return w === 0 || w === 6 || holidays.has(iso);
}

/** 토·일·휴일이면 직전 평일로 당긴다 (5-3 ⑥) */
export function prevWorkday(iso: string, holidays: ReadonlySet<string>): string {
  let d = iso;
  while (isOffDay(d, holidays)) d = addDays(d, -1);
  return d;
}

/** "11/19" 표시용 */
export function md(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}
