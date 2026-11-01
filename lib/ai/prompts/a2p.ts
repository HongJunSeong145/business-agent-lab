import { TEMPLATES, type TemplateKey } from "@kgb/rules";
import { COUNCIL_RULES, DATA_ISOLATION } from "./common";

export const A2P_PROMPT_VERSION = "a2p-v2";

export const A2P_SYSTEM = `너는 학생회 사업의 업무 분장을 '결재된 최종 기획안' 기준으로 다시 맞추는 기획 보조다. 최종 기획안이 가장 중요한 기준이고, 이전 회의록에서 나온 업무는 기획안과 다르면 기획안에 맞게 고친다.${DATA_ISOLATION}${COUNCIL_RULES}`;

export function a2pPrompt(i: { projectTitle: string; planVersion: number; tasks: { ref: string; title: string; lead: string; support: string[]; due: string | null; template_key: string | null; status: string }[] }) {
  const templates = (Object.keys(TEMPLATES) as TemplateKey[]).map((k) => `${k}: ${TEMPLATES[k].title} (주관 ${TEMPLATES[k].lead})`).join("\n");
  return `사업 '${i.projectTitle}'의 기획안 v${i.planVersion}이 결재되었다. <document name="결재 기획안">을 기준으로 현재 업무 목록을 점검해 제출하라.

[현재 업무 — 번호로만 가리킨다]
${i.tasks.map((t) => `${t.ref}. ${t.title} | 주관 ${t.lead}${t.support.length ? ` · 협조 ${t.support.join(",")}` : ""} | 마감 ${t.due ?? "없음"} | ${t.status}${t.template_key ? ` | 표준 ${t.template_key}` : ""}`).join("\n") || "없음"}

[표준 업무 템플릿]
${templates}

[작성 규칙]
1. update_tasks: 기획안 내용(행사명·일시·장소·예산·행사 내용·타임테이블)과 어긋나는 업무만 고친다. 바꿀 필드만 채우고 나머지는 null. reason 에 기획안의 어느 부분 때문인지 쓴다.
2. 표준 업무(표준 키가 있는 업무)의 마감은 코드가 행사일로 계산하므로 due_date 는 null 로 둔다. 표준이 아닌 업무만 기획안 타임테이블·일정에 근거가 있을 때 due_date 를 넣는다.
3. add_tasks: 기획안에 있는데 업무 목록에 없는 일(예: 타임테이블의 리허설·부스 설치, 기획안에 적힌 협찬·대여)만 더한다. 담당자(사람)는 정하지 않는다.
4. cancel_tasks: 기획안에서 빠졌거나 더 이상 필요 없는 업무만. 이미 완료된 업무는 건드리지 않는다.
5. 바꿀 것이 없으면 빈 배열. notes 에 한두 문장으로 요약한다.
6. 국서: planning·finance·secretariat·promotion·operations 중 하나.`;
}
