/**
 * 재원 규칙 (5-1, D15) — 세금, 명단 필요 여부, 증빙 요구사항.
 */
export type FundingSource = "school" | "student_fee";

/** 교비 세금 10% (원 단위 반올림) */
export function schoolTax(amount: number, rate: number): number {
  return Math.round(amount * rate);
}

export function withTax(amount: number, rate: number): { amount: number; tax: number; total: number } {
  const tax = schoolTax(amount, rate);
  return { amount, tax, total: amount + tax };
}

/** D15: 수혜 인원 > 기준이면 명단 선택, ≤ 기준이면 필수. 인원을 모르면 필수로 본다(보수적). */
export function rosterRequired(beneficiaries: number | null, threshold: number): boolean {
  return beneficiaries === null || beneficiaries <= threshold;
}

export type EvidenceType = "receipt" | "photo" | "beneficiary_roster" | "official_letter" | "plan_doc" | "quote" | "transfer_record" | "other";

export type EvidenceRequirement = { type: EvidenceType; required: boolean; rule_source: string; label: string };

export function evidenceRequirements(
  funding: readonly FundingSource[],
  beneficiaries: number | null,
  p: { ROSTER_THRESHOLD: number },
): EvidenceRequirement[] {
  const out: EvidenceRequirement[] = [];
  const fee = funding.includes("student_fee");
  const school = funding.includes("school");
  if (school) {
    out.push({ type: "official_letter", required: true, rule_source: "SCHOOL_OFFICIAL_LETTER", label: "공문(행정실 송부)" });
    out.push({ type: "plan_doc", required: true, rule_source: "SCHOOL_PLAN_DOC", label: "기획안(행정실 송부)" });
  }
  if (fee) {
    out.push({ type: "receipt", required: true, rule_source: "FEE_RECEIPT", label: "영수증 또는 이체내역" });
    out.push({ type: "photo", required: true, rule_source: "FEE_PHOTO", label: "행사 사진" });
    const need = rosterRequired(beneficiaries, p.ROSTER_THRESHOLD);
    out.push({
      type: "beneficiary_roster",
      required: need,
      rule_source: need ? `FEE_ROSTER_LE_${p.ROSTER_THRESHOLD}` : `FEE_ROSTER_GT_${p.ROSTER_THRESHOLD}`,
      label: need ? `수혜자 명단(수혜 ${p.ROSTER_THRESHOLD}명 이하 필수)` : `수혜자 명단(수혜 ${p.ROSTER_THRESHOLD}명 초과 — 선택)`,
    });
  } else if (school) {
    out.push({ type: "photo", required: false, rule_source: "SCHOOL_PHOTO_RECOMMENDED", label: "행사 사진(권장)" });
  }
  return out;
}
