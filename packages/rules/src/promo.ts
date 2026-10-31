/** 홍보물 등급 (5-4): 비용 ≥ 기준 또는 수량 ≥ 기준이면 고비용(유형 무관), 비용 > 0 이면 저비용, 아니면 무비용 */
export type PromoTier = "free" | "low" | "high";

export const PROMO_TIER_LABEL: Record<PromoTier, string> = { free: "무비용", low: "저비용", high: "고비용" };

export function promoTier(input: { cost: number; qty: number }, p: { PROMO_HIGH_COST_AMOUNT: number; PROMO_HIGH_QTY: number }): PromoTier {
  if (input.cost >= p.PROMO_HIGH_COST_AMOUNT || input.qty >= p.PROMO_HIGH_QTY) return "high";
  if (input.cost > 0) return "low";
  return "free";
}
