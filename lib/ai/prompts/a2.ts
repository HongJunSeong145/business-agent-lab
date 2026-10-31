import { TEMPLATES, type TemplateKey } from "@kgb/rules";
import { COUNCIL_RULES, DATA_ISOLATION } from "./common";

export const A2_PROMPT_VERSION = "a2-v3";

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
2. tasks: 회의록에 근거가 있는 업무만 inferred=false 로 넣고 evidence(문단 번호·원문 인용)를 단다. **빠뜨리지 않는다**:
   - A1 의 action_items 는 하나도 빠짐없이 각각 업무로 넣는다.
   - 회의록 문장 중 "~작성요망", "~필요", "~할 것", "~해 올릴 것", "~했으면 좋겠음", "~검토", "~보고" 처럼 누군가 해야 할 일을 말하는 문장은 모두 업무로 넣는다(주어가 없으면 학생회 규칙으로 맡을 국서를 정한다 — 예: 집행 매뉴얼 → 집행국, 홍보물 → 홍보국, 기획안 → 기획국, 구입 → 재정국).
   - 기존 사업의 업무와 같은 일이면 기존 업무 제목을 그대로 쓰거나 같은 template_key 를 넣어 연결한다(코드가 중복 없이 연결하고, 회의록에 다른 기한이 있으면 마감 변경으로 올린다).
3. 회의록에 없지만 학생회 관행상 꼭 필요한 업무를 덧붙일 때만 inferred=true, inference_reason 에 근거 규칙을 쓴다(표준 템플릿 업무는 코드가 따로 채우므로 굳이 추론하지 않아도 된다).
4. 국서 배정: lead_department 는 정확히 1개, 협조는 support_departments. 담당자(사람)는 국장이 정하므로 추천하지 않는다 — assignee_hint 는 항상 null.
5. due_date 는 회의록에 명시된 기한만. 없으면 null(규칙 엔진이 계산).
6. project_ref: 이 회의의 사업이면 projects[].ref, 기존 사업이면 그 id, 사업과 무관한 업무면 null.
7. 확신도(confidence)를 0~1 로 솔직하게 매긴다.`;
}
