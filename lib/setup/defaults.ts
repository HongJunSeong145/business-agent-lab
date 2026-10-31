import { DEPARTMENTS, DEPARTMENT_CODES } from "@/lib/design/tokens";

export type Holiday = { date: string; name: string };

export const KOREAN_HOLIDAYS_2026_2027: Holiday[] = [
  { date: "2026-01-01", name: "신정" },
  { date: "2026-02-16", name: "설날 연휴" }, { date: "2026-02-17", name: "설날" }, { date: "2026-02-18", name: "설날 연휴" },
  { date: "2026-03-02", name: "삼일절 대체공휴일" },
  { date: "2026-05-05", name: "어린이날" },
  { date: "2026-05-25", name: "부처님오신날 대체공휴일" },
  { date: "2026-06-03", name: "전국동시지방선거" },
  { date: "2026-08-17", name: "광복절 대체공휴일" },
  { date: "2026-09-24", name: "추석 연휴" }, { date: "2026-09-25", name: "추석" }, { date: "2026-09-26", name: "추석 연휴" },
  { date: "2026-09-28", name: "추석 대체공휴일" },
  { date: "2026-10-05", name: "개천절 대체공휴일" },
  { date: "2026-10-09", name: "한글날" },
  { date: "2026-12-25", name: "성탄절" },
  { date: "2027-01-01", name: "신정" },
  { date: "2027-02-06", name: "설날 연휴" }, { date: "2027-02-07", name: "설날" }, { date: "2027-02-08", name: "설날 연휴" },
  { date: "2027-02-09", name: "설날 대체공휴일" },
  { date: "2027-03-01", name: "삼일절" },
  { date: "2027-05-05", name: "어린이날" },
  { date: "2027-05-13", name: "부처님오신날" },
  { date: "2027-08-16", name: "광복절 대체공휴일" },
  { date: "2027-09-14", name: "추석 연휴" }, { date: "2027-09-15", name: "추석" }, { date: "2027-09-16", name: "추석 연휴" },
  { date: "2027-10-04", name: "개천절 대체공휴일" },
  { date: "2027-10-11", name: "한글날 대체공휴일" },
  { date: "2027-12-27", name: "성탄절 대체공휴일" },
];

/** 규칙 엔진 파라미터 기본값 (지시서 5-7 + DATA_MODEL §4, 사용자 결정 N5) */
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  SCHOOL_SUBMIT_LEAD_DAYS: 21,
  VENDOR_CONFIRM_BUFFER_DAYS: 7,
  SCHOOL_TAX_RATE: 0.1,
  ROSTER_THRESHOLD: 100,
  PROMO_HIGH_COST_AMOUNT: 300000,
  PROMO_HIGH_QTY: 300,
  PROMO_PUBLISH_LATEST_DAYS: 7,
  OPS_MANUAL_LATEST_DAYS: 7,
  PURCHASE_LATEST_DAYS: 3,
  EVIDENCE_PHOTO_GRACE_DAYS: 1,
  STALL_DAYS: 3,
  AI_DAILY_BUDGET_KRW: 30000,
  UPLOAD_MAX_MB: 50,
  MEMBER_CAN_UPLOAD_MINUTES: false,
  FINANCE_COLOR_HEX: "#8EC5E4",
  PROMO_DURATIONS: { free: 3, low: 4, high: 17 },
  DEFAULT_DURATIONS: {
    FIN_BUDGET_RANGE: 3,
    PLN_DRAFT: 5,
    PLN_APPROVAL: 3,
    SEC_PARTNER_LIST: 3,
    SEC_PROPOSAL: 4,
    SEC_CONTACT: 10,
    VENDOR_CONFIRM: 7,
    PRO_TIER: 1,
    PRO_PUBLISH: 1,
    OPS_MANUAL: 5,
    FIN_PURCHASE_LIST: 2,
    FIN_PURCHASE: 1,
  },
  // 대한민국 공휴일(대체공휴일 포함) 2026~2027 — 사용자 확인 필요(N11). 학사 휴일은 설정 화면에서 추가.
  HOLIDAYS: KOREAN_HOLIDAYS_2026_2027,
};

export const DEFAULT_CONTACT_COLUMNS = [
  { key: "category", label: "구분", type: "select" },
  { key: "org", label: "기관/업체명", type: "text" },
  { key: "contact_person", label: "담당자", type: "text" },
  { key: "title", label: "직함", type: "text" },
  { key: "phone", label: "연락처", type: "phone" },
  { key: "email", label: "이메일", type: "email" },
  { key: "website", label: "웹사이트", type: "url" },
  { key: "note", label: "비고", type: "text" },
] as const;

export const CONTACT_CATEGORIES = ["학교 관계자", "제휴업체", "대행사", "푸드트럭", "기타"];

export function defaultDepartments() {
  return DEPARTMENT_CODES.map((code) => ({
    code,
    name_ko: DEPARTMENTS[code].nameKo,
    color_hex: DEPARTMENTS[code].base,
    display_order: DEPARTMENTS[code].order,
  }));
}

/**
 * 기수 기본 날짜(가상값 — 설정 화면에서 수정, Q3).
 * 오늘이 포함되는 '12/1 ~ 다음해 11/30' 기수를 만들고 분기를 일반적인 학사일정으로 나눈다.
 */
export function defaultTermDates(today: Date) {
  const y = today.getUTCMonth() === 11 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  const d = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd));
  return {
    start_date: d(y, 12, 1),
    end_date: d(y + 1, 11, 30),
    q1_start: d(y, 12, 1),
    q1_end: d(y + 1, 3, 1),
    q2_start: d(y + 1, 3, 2),
    q2_end: d(y + 1, 6, 21),
    q3_start: d(y + 1, 6, 22),
    q3_end: d(y + 1, 8, 31),
    q4_start: d(y + 1, 9, 1),
    q4_end: d(y + 1, 11, 30),
  };
}
