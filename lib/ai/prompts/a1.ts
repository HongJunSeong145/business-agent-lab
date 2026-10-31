import { COUNCIL_RULES, DATA_ISOLATION } from "./common";

export const A1_PROMPT_VERSION = "a1-v1";

export const A1_SYSTEM = `너는 대학 학생회 회의록을 정리하는 비서다.${DATA_ISOLATION}${COUNCIL_RULES}`;

export function a1Prompt(meta: { title: string; meetingDate: string; meetingType: string; projects: { title: string; event_start: string | null }[] }): string {
  return `다음 회의록을 분석해 submit_result 로 제출하라.

[회의 정보] 제목: ${meta.title} / 회의일: ${meta.meetingDate} / 유형: ${meta.meetingType}
[진행 중 사업(참고)] ${meta.projects.length ? meta.projects.map((p) => `${p.title}(${p.event_start ?? "날짜 미정"})`).join(", ") : "없음"}

[작성 규칙]
1. 회의록 각 줄 앞의 [번호]가 문단 번호다. 모든 항목에 근거 문단 번호(para)와 그 문단에서 그대로 복사한 짧은 인용(quote, 30자 안팎)을 넣는다. 인용은 원문 글자 그대로여야 한다.
2. agenda: 안건별로 결정사항(decisions)·논의사항(discussions)·보류사항(pending)을 나눈다. "→/->", "결정", "진행하기로" 등은 결정, 의견 나열은 논의, "추후", "보류"는 보류.
3. action_items: 누가(who, 국서명 또는 직책), 무엇을(what), 언제(due_text 원문 표현, due_date 해석 날짜). "국서별 업무 지시 사항" 표가 있으면 각 행을 액션아이템으로 넣는다.
4. 날짜: "다음주 월요일", "금요일까지" 같은 상대 표현은 회의일(${meta.meetingDate}) 기준으로 해석하고 date_confidence 를 low 로 한다. 연도가 없는 "11. 3(화)" 같은 표현은 회의일과 가장 가까운 미래 날짜로 해석하고 medium.
5. events: 행사·사업이 될 만한 것(날짜·장소·예상 인원·재원·외부업체 여부). 확실하지 않은 값은 null.
6. budget: 금액·구입 항목·재원 언급.
7. 회의록에 없는 내용은 만들지 않는다.`;
}
