/** 규칙 엔진 파라미터 (5-7) — settings 에서 읽고, 없으면 기본값 */
export type DurationKey =
  | "FIN_BUDGET_RANGE" | "PLN_DRAFT" | "PLN_APPROVAL" | "SEC_PARTNER_LIST" | "SEC_PROPOSAL" | "SEC_CONTACT"
  | "VENDOR_CONFIRM" | "PRO_TIER" | "PRO_PUBLISH" | "OPS_MANUAL" | "FIN_PURCHASE_LIST" | "FIN_PURCHASE";

export type RuleParams = {
  SCHOOL_SUBMIT_LEAD_DAYS: number;
  VENDOR_CONFIRM_BUFFER_DAYS: number;
  SCHOOL_TAX_RATE: number;
  ROSTER_THRESHOLD: number;
  PROMO_HIGH_COST_AMOUNT: number;
  PROMO_HIGH_QTY: number;
  PROMO_PUBLISH_LATEST_DAYS: number;
  OPS_MANUAL_LATEST_DAYS: number;
  PURCHASE_LATEST_DAYS: number;
  EVIDENCE_PHOTO_GRACE_DAYS: number;
  DEFAULT_DURATIONS: Record<DurationKey, number>;
  PROMO_DURATIONS: { free: number; low: number; high: number };
  HOLIDAYS: string[];
};

export const DEFAULT_PARAMS: RuleParams = {
  SCHOOL_SUBMIT_LEAD_DAYS: 21,
  VENDOR_CONFIRM_BUFFER_DAYS: 7,
  SCHOOL_TAX_RATE: 0.1,
  ROSTER_THRESHOLD: 100,
  PROMO_HIGH_COST_AMOUNT: 300_000,
  PROMO_HIGH_QTY: 300,
  PROMO_PUBLISH_LATEST_DAYS: 7,
  OPS_MANUAL_LATEST_DAYS: 7,
  PURCHASE_LATEST_DAYS: 3,
  EVIDENCE_PHOTO_GRACE_DAYS: 1,
  DEFAULT_DURATIONS: {
    FIN_BUDGET_RANGE: 3, PLN_DRAFT: 5, PLN_APPROVAL: 3, SEC_PARTNER_LIST: 3, SEC_PROPOSAL: 4, SEC_CONTACT: 10,
    VENDOR_CONFIRM: 7, PRO_TIER: 1, PRO_PUBLISH: 1, OPS_MANUAL: 5, FIN_PURCHASE_LIST: 2, FIN_PURCHASE: 1,
  },
  // 저비용 4일: 사용자 결정 N5 (지시서의 제작 4 + 인쇄 3 을 대체), 고비용 = 제작 7 + 발주 10
  PROMO_DURATIONS: { free: 3, low: 4, high: 17 },
  HOLIDAYS: [],
};

/** 최소 소요일(대안 (a) 압축) — 기본 소요의 절반 올림, 최소 1일 (N6) */
export function minDuration(d: number): number {
  return Math.max(1, Math.ceil(d / 2));
}
