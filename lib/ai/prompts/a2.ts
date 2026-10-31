import { TEMPLATES, type TemplateKey } from "@kgb/rules";
import { COUNCIL_RULES, DATA_ISOLATION } from "./common";

export const A2_PROMPT_VERSION = "a2-v1";

export const A2_SYSTEM = `너는 학생회 회의록 분석 결과로 사업과 국서별 업무를 제안하는 기획 보조다.${DATA_ISOLATION}${COUNCIL_RULES}`;

export function a2Prompt(input: {
  meetingDate: string;
  summaryJson: string;
  projects: { id: string; title: string; event_start: string | null; tasks: string[] }[];
}): string {
  const templates = (Object.keys(TEMPLATES) as TemplateKey[]).map((k) => `${k}: ${TEMPLATES[k].title} (주관 ${TEMPLATES[k].lead})`).join("\n");
  return `회의록 분석 결과(A1)를 바탕으로 사업과 업무를 제안해 submit_result 로 제출하라. 회의일: ${input.meetingDate}

[A1 분석 결과]
${input.summaryJson}

[기존 사업 — 같은 사업이면 새로 만들지 말고 existing_project_id 를 넣는다]
${input.projects.length ? input.projects.map((p) => `- id=${p.id} | ${p.title} | ${p.event_start ?? "날짜 미정"} | 기존 업무: ${p.tasks.join(", ") || "없음"}`).join("\n") : "없음"}

[표준 업무 템플릿 — 업무가 이 중 하나에 해당하면 template_key 를 넣는다]
${templates}

[작성 규칙]
1. projects: 회의에서 다룬 행사·사업. 기존 사업과 제목·날짜·장소가 비슷하면 existing_project_id 를 넣는다. ref 는 "P1","P2"처럼 짓는다.
2. tasks: 회의록에 근거가 있는 업무만 inferred=false 로 넣고 evidence(문단 번호·원문 인용)를 단다. 액션아이템과 "국서별 업무 지시 사항"은 반드시 업무로 넣는다.
3. 회의록에 없지만 학생회 관행상 꼭 필요한 업무를 덧붙일 때만 inferred=true, inference_reason 에 근거 규칙을 쓴다(표준 템플릿 업무는 코드가 따로 채우므로 굳이 추론하지 않아도 된다).
4. 국서 배정: lead_department 는 정확히 1개, 협조는 support_departments. 담당자 이름·직책은 assignee_hint 에 그대로.
5. due_date 는 회의록에 명시된 기한만. 없으면 null(규칙 엔진이 계산).
6. project_ref: 이 회의의 사업이면 projects[].ref, 기존 사업이면 그 id, 사업과 무관한 업무면 null.
7. 확신도(confidence)를 0~1 로 솔직하게 매긴다.`;
}
