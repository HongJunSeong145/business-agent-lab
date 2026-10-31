import { TEMPLATES, type TemplateKey } from "@kgb/rules";

/** 업무에 완료 기준이 없을 때 쓰는 국서 기본 기준 (6-2 A6, 6-3) */
export const DEPT_DEFAULT_CRITERIA: Record<string, string[]> = {
  planning: ["일시·장소·예산액", "주최·주관·행사명", "배경 및 목적", "구체적 행사 내용", "타임테이블(필요 시)"],
  finance: ["항목별 금액과 합계", "재원 구분", "증빙과의 대응(세부내역)", "계산 오류 없음"],
  secretariat: ["문의 대상·채널 목록", "기획안에 근거한 요청 내용", "회신 일정·담당자"],
  promotion: ["행사명·일시·장소 정보 정확", "핵심 메시지와 참여 방법", "주최·주관 표기", "가독성(글자 크기·대비·배치)", "오탈자 없음"],
  operations: ["역할·인원 배치", "시간대별 진행 순서", "비상 연락·안전 수칙", "준비물 목록"],
};

export function criteriaFor(task: { acceptance_criteria: unknown; template_key: string | null }, deptCode: string): { list: string[]; source: "task" | "default" } {
  const own = Array.isArray(task.acceptance_criteria)
    ? (task.acceptance_criteria as { text?: unknown }[]).map((c) => (typeof c?.text === "string" ? c.text.trim() : "")).filter(Boolean)
    : [];
  if (own.length) return { list: own.slice(0, 20), source: "task" };
  const tpl = task.template_key && task.template_key in TEMPLATES ? TEMPLATES[task.template_key as TemplateKey].criteria : [];
  if (tpl.length) return { list: tpl, source: "default" };
  return { list: DEPT_DEFAULT_CRITERIA[deptCode] ?? ["업무 설명에 맞는 결과물", "오탈자·정보 오류 없음"], source: "default" };
}
