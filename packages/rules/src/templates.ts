import type { DependencyType } from "./readiness";
import type { FundingSource } from "./funding";

/**
 * 표준 업무 템플릿 (5-2, 행사 기준). ADR-011: 학생회장 주관 업무(PRES_SUBMIT_SCHOOL)는 업무가 아니라
 * 교비 사업의 '행정실 송부 마감' 마일스톤(SCHOOL_SUBMIT)으로만 존재한다. 협조자 '학생회장'은 제외.
 * SEC_MONITOR(주 1회 상시)는 단일 마감이 아니므로 템플릿에서 제외(ADR-014 ⑪, Phase 9 모니터링).
 */
export type TemplateKey =
  | "FIN_BUDGET_RANGE" | "PLN_DRAFT" | "PLN_APPROVAL" | "SEC_PARTNER_LIST" | "SEC_PROPOSAL" | "SEC_CONTACT"
  | "VENDOR_CONFIRM" | "PRO_TIER" | "PRO_MAKE" | "PRO_PUBLISH" | "OPS_MANUAL" | "FIN_PURCHASE_LIST" | "FIN_PURCHASE"
  | "OPS_EXECUTE" | "OPS_EVIDENCE" | "FIN_EVIDENCE";

export type Dept = "planning" | "finance" | "secretariat" | "promotion" | "operations";

export type TemplateDef = {
  key: TemplateKey;
  title: string;
  lead: Dept;
  support: Dept[];
  deps: { key: TemplateKey; type: DependencyType }[];
  /** pre: 행사 전 역산, day: 행사 당일, post: 행사 후 순방향 */
  phase: "pre" | "day" | "post";
  criteria: string[];
};

const AR = "approval_required" as const;
const FS = "finish_to_start" as const;
const DO = "draft_ok" as const;

export const TEMPLATES: Record<TemplateKey, TemplateDef> = {
  FIN_BUDGET_RANGE: { key: "FIN_BUDGET_RANGE", title: "행사 예산 범위 설정 및 예산 시나리오 제공", lead: "finance", support: [], deps: [], phase: "pre", criteria: ["최소·표준·확대 예산 시나리오", "재원별 금액"] },
  PLN_DRAFT: { key: "PLN_DRAFT", title: "기획안 초안 작성", lead: "planning", support: ["finance"], deps: [{ key: "FIN_BUDGET_RANGE", type: DO }], phase: "pre", criteria: ["일시·장소·예산액", "주최·주관·행사명", "배경 및 목적", "행사 내용", "타임테이블(필요 시)"] },
  PLN_APPROVAL: { key: "PLN_APPROVAL", title: "기획안 검토 및 결재", lead: "planning", support: [], deps: [{ key: "PLN_DRAFT", type: FS }], phase: "pre", criteria: ["회장 결재 완료"] },
  SEC_PARTNER_LIST: { key: "SEC_PARTNER_LIST", title: "행사 취지에 맞는 제휴 후보 리스트업", lead: "secretariat", support: [], deps: [{ key: "PLN_DRAFT", type: DO }], phase: "pre", criteria: ["후보 기업·문의 채널 목록"] },
  SEC_PROPOSAL: { key: "SEC_PROPOSAL", title: "제휴 요청서(PPT 구성안) 및 이메일 문안 작성", lead: "secretariat", support: ["planning"], deps: [{ key: "PLN_APPROVAL", type: AR }], phase: "pre", criteria: ["요청서 구성안", "이메일 문안"] },
  SEC_CONTACT: { key: "SEC_CONTACT", title: "제휴 문의 발송·회신 관리·확정", lead: "secretariat", support: [], deps: [{ key: "SEC_PROPOSAL", type: FS }], phase: "pre", criteria: ["문의 발송 기록", "확정 업체"] },
  VENDOR_CONFIRM: { key: "VENDOR_CONFIRM", title: "외부업체·대행사 견적 및 확정", lead: "secretariat", support: ["finance"], deps: [{ key: "PLN_APPROVAL", type: AR }], phase: "pre", criteria: ["견적서", "업체 확정"] },
  PRO_TIER: { key: "PRO_TIER", title: "홍보물 등급 결정(무비용/저비용/고비용)", lead: "promotion", support: ["finance"], deps: [{ key: "PLN_APPROVAL", type: AR }], phase: "pre", criteria: ["등급과 예상 비용·수량"] },
  PRO_MAKE: { key: "PRO_MAKE", title: "홍보물 제작", lead: "promotion", support: [], deps: [{ key: "PLN_APPROVAL", type: AR }, { key: "PRO_TIER", type: FS }], phase: "pre", criteria: ["행사 일시·장소 포함", "최종본"] },
  PRO_PUBLISH: { key: "PRO_PUBLISH", title: "홍보물 게시·배포", lead: "promotion", support: ["secretariat"], deps: [{ key: "PRO_MAKE", type: FS }], phase: "pre", criteria: ["게시 채널·일시 기록"] },
  OPS_MANUAL: { key: "OPS_MANUAL", title: "집행 매뉴얼 작성(인력 배치·동선·역할·비상연락)", lead: "operations", support: ["planning"], deps: [{ key: "PLN_APPROVAL", type: AR }], phase: "pre", criteria: ["역할표", "동선", "체크리스트", "비상 대응"] },
  FIN_PURCHASE_LIST: { key: "FIN_PURCHASE_LIST", title: "행사별 구입 리스트 정리", lead: "finance", support: ["planning", "operations"], deps: [{ key: "PLN_APPROVAL", type: AR }], phase: "pre", criteria: ["품목·수량·단가·재원"] },
  FIN_PURCHASE: { key: "FIN_PURCHASE", title: "최종 구입 진행", lead: "finance", support: [], deps: [{ key: "FIN_PURCHASE_LIST", type: FS }], phase: "pre", criteria: ["구입 완료", "영수증 확보"] },
  OPS_EXECUTE: { key: "OPS_EXECUTE", title: "행사 당일 집행", lead: "operations", support: ["planning", "finance", "secretariat", "promotion"], deps: [{ key: "OPS_MANUAL", type: FS }], phase: "day", criteria: ["매뉴얼대로 집행"] },
  OPS_EVIDENCE: { key: "OPS_EVIDENCE", title: "현장 사진·수혜자 명단 수집", lead: "operations", support: ["planning"], deps: [], phase: "post", criteria: ["행사 사진", "수혜자 명단(필요 시)"] },
  FIN_EVIDENCE: { key: "FIN_EVIDENCE", title: "증빙 정리·검수·결산 반영", lead: "finance", support: [], deps: [{ key: "OPS_EVIDENCE", type: FS }, { key: "FIN_PURCHASE", type: FS }], phase: "post", criteria: ["증빙 누락 없음", "결산 반영"] },
};

export const TEMPLATE_ORDER: TemplateKey[] = [
  "FIN_BUDGET_RANGE", "PLN_DRAFT", "PLN_APPROVAL", "SEC_PARTNER_LIST", "SEC_PROPOSAL", "SEC_CONTACT", "VENDOR_CONFIRM",
  "PRO_TIER", "PRO_MAKE", "PRO_PUBLISH", "OPS_MANUAL", "FIN_PURCHASE_LIST", "FIN_PURCHASE", "OPS_EXECUTE", "OPS_EVIDENCE", "FIN_EVIDENCE",
];

export type ProjectShape = { funding: readonly FundingSource[]; usesVendor: boolean };

/** 사업 조건에 맞는 표준 업무와 의존관계 (외부업체 → VENDOR_CONFIRM, 학생회비 → 증빙 업무 필수, 교비 → 사진 권장) */
export function templateFor(p: ProjectShape): TemplateDef[] {
  const fee = p.funding.includes("student_fee");
  const keys = TEMPLATE_ORDER.filter((k) => {
    if (k === "VENDOR_CONFIRM") return p.usesVendor;
    if (k === "OPS_EVIDENCE") return fee || p.funding.includes("school");
    if (k === "FIN_EVIDENCE") return fee;
    return true;
  });
  return keys.map((k) => {
    const def = TEMPLATES[k];
    // 외부업체를 쓰면 최종 구입 전에 업체가 확정되어야 한다
    if (k === "FIN_PURCHASE" && p.usesVendor) return { ...def, deps: [...def.deps, { key: "VENDOR_CONFIRM" as const, type: FS }] };
    return def;
  });
}
