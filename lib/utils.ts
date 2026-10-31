import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const KST = "Asia/Seoul";

/** 'YYYY-MM-DD' (KST 기준) */
export function kstDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KST, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** DB date 컬럼(UTC 자정) → 'YYYY-MM-DD' */
export function dateColumnToString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function formatKoreanDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const wd = ["일", "월", "화", "수", "목", "금", "토"][new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()];
  return `${m}월 ${d}일(${wd})`;
}

/** D-n 표기: 오늘=D-day, 지난 날=D+n */
export function dDayLabel(targetIso: string, todayIso: string): string {
  const diff = Math.round((Date.parse(targetIso) - Date.parse(todayIso)) / 86_400_000);
  if (diff === 0) return "D-day";
  return diff > 0 ? `D-${diff}` : `D+${-diff}`;
}
