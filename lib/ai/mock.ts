import type { A6Output } from "./schemas/a6";
import type { CompleteRequest, MockHandler } from "./provider";
import type { A1Summary, DeptCode } from "./schemas/a1";
import type { A2Output } from "./schemas/a2";
import type { Paragraph } from "./grounding";
import { parseKoreanDates } from "./korean-dates";

/**
 * 결정적 mock 분석기 (AI_PROVIDER=mock, 테스트·개발 전용 — 3-4).
 * 실제 LLM 대신 간단한 규칙으로 같은 스키마의 결과를 만든다. 같은 입력이면 항상 같은 출력.
 * 회의록 안의 지시문("…하라")은 그냥 글자로 취급한다(T24 구조적 방어와 동일).
 */
export type A1MockContext = { paragraphs: Paragraph[]; meetingDate: string };
export type A2MockContext = { summary: A1Summary; meetingDate: string; projects: { id: string; title: string }[] };

const DEPT_WORDS: [DeptCode, RegExp][] = [
  ["planning", /기획국|기획차장|기획안/],
  ["finance", /재정국|예산|구입|결산|회계/],
  ["secretariat", /사무국|제휴|문의|요청서/],
  ["promotion", /홍보국|홍보물|카드뉴스|포스터|현수막|안내물|경고물/],
  ["operations", /집행국|집행|매뉴얼|패트롤|관리대장|물품/],
];
export function guessDept(text: string): DeptCode | null {
  for (const [d, re] of DEPT_WORDS) if (re.test(text)) return d;
  return null;
}

const quoteOf = (t: string) => t.trim().slice(0, 40);
const EVENT_WORDS = /행사|축제|포차|간식|송별회|데이|설명회|체육대회|MT|엠티/;
const GENERIC = new Set(["행사", "사업", "관한", "건", "특별", "진행"]);

export function mockA1(ctx: A1MockContext): A1Summary {
  const { paragraphs: ps, meetingDate } = ctx;
  const agenda: A1Summary["agenda"] = [];
  const action_items: A1Summary["action_items"] = [];
  const mentioned_dates: A1Summary["mentioned_dates"] = [];
  const budget: A1Summary["budget"] = [];
  const events: A1Summary["events"] = [];
  let section: "report" | "deliberation" | "other" = "other";
  let tableDept: DeptCode | null = null;

  for (const p of ps) {
    const t = p.text.trim();
    if (/보고\s*안건/.test(t)) section = "report";
    else if (/논의|심의/.test(t) && /안건/.test(t)) section = "deliberation";
    else if (/기타\s*안건/.test(t)) section = "other";

    const head = /^(\d{1,2})\.\s*(.{2,})$/.exec(t);
    const isTableRow = /(\d{1,2}\.\s*\d{1,2}\s*\([월화수목금토일]\)|\s-)\s*$/.test(t);
    if (head && !/^\d{1,2}\.\s*\d/.test(t) && t.length < 60 && !isTableRow) {
      agenda.push({ title: head[2]!.trim(), para: p.n, kind: section, decisions: [], discussions: [], pending: [] });
    } else if (agenda.length && /^[-–•·]|^->|^→/.test(t)) {
      const a = agenda[agenda.length - 1]!;
      const item = { text: t.replace(/^(->|→|[-–•·])\s*/, ""), para: p.n, quote: quoteOf(t) };
      if (/^->|^→|결정|하기로/.test(t)) a.decisions.push(item);
      else if (/추후|보류|미정/.test(t)) a.pending.push(item);
      else a.discussions.push(item);
    }

    // 표 행("홍보국 | 1. ... | 11. 3(화)" 또는 "홍보국 1. ... 11. 3(화)")
    const tableRow = /^(기획국|재정국|사무국|홍보국|집행국)?\s*\|?\s*(\d{1,2})\.\s*(.+?)\s*\|?\s*((\d{1,2})\.\s*(\d{1,2})\s*\([월화수목금토일]\)|-)?\s*$/.exec(t);
    const dateHits = parseKoreanDates(t, meetingDate);
    for (const d of dateHits) mentioned_dates.push({ text: d.text, date: d.date, date_confidence: d.confidence, para: p.n, quote: quoteOf(t) });
    if (/^(기획국|재정국|사무국|홍보국|집행국)\s*$/.test(t)) tableDept = guessDept(t);
    if (tableRow && (tableRow[1] || tableDept) && tableRow[3] && !/에 관한 건$/.test(tableRow[3])) {
      const dept = guessDept(tableRow[1] ?? "") ?? tableDept;
      const d = dateHits[0];
      action_items.push({ who: tableRow[1] ?? null, department: dept, what: tableRow[3].replace(/\|.*$/, "").trim(), due_text: d?.text ?? null, due_date: d?.date ?? null, date_confidence: d?.confidence ?? "low", para: p.n, quote: quoteOf(t) });
    } else if (/까지|예정|요망|담당/.test(t) && !head) {
      const d = dateHits[0];
      action_items.push({ who: null, department: guessDept(t), what: t.replace(/^(->|→|[-–•·>])\s*/, "").slice(0, 200), due_text: d?.text ?? null, due_date: d?.date ?? null, date_confidence: d?.confidence ?? "low", para: p.n, quote: quoteOf(t) });
    }

    for (const m of t.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)\s*원/g)) {
      budget.push({ item: t.slice(0, 80), amount: Number(m[1]!.replace(/,/g, "")), funding_source: /교비/.test(t) ? "school" : /학생회비/.test(t) ? "student_fee" : null, para: p.n, quote: quoteOf(t) });
    }
  }

  for (const a of agenda) {
    if (!EVENT_WORDS.test(a.title)) continue;
    const related = ps.filter((p) => p.n >= a.para && p.n < (agenda[agenda.indexOf(a) + 1]?.para ?? Infinity));
    const all = related.map((p) => p.text).join(" ");
    const date = related.flatMap((p) => parseKoreanDates(p.text, meetingDate))[0];
    const people = /(\d+)\s*(?:명|인분)/.exec(all);
    const funding = [...(/교비/.test(all) ? (["school"] as const) : []), ...(/학생회비/.test(all) ? (["student_fee"] as const) : [])];
    events.push({
      title: a.title.replace(/에 관한 건$|\s*건$/, ""),
      date: date?.date ?? null,
      date_confidence: date?.confidence ?? "low",
      venue: /장소\s*[:：]\s*([^,\n]+)/.exec(all)?.[1]?.trim() ?? null,
      beneficiaries: people ? Number(people[1]) : null,
      funding: [...funding],
      uses_vendor: /업체|대행사|대관/.test(all) ? true : null,
      para: a.para,
      quote: quoteOf(ps.find((p) => p.n === a.para)!.text),
    });
  }
  // 개요와 본문에 같은 안건이 두 번 나오는 회의록: 같은 제목 행사는 하나로 합친다(값이 있는 쪽 우선)
  const merged: typeof events = [];
  for (const e of events) {
    const same = merged.find((m) => m.title.replace(/\s/g, "") === e.title.replace(/\s/g, ""));
    if (!same) merged.push(e);
    else {
      same.date ??= e.date;
      if (same.date === e.date || !same.date) same.date_confidence = e.date ? e.date_confidence : same.date_confidence;
      same.venue ??= e.venue;
      same.beneficiaries ??= e.beneficiaries;
      same.uses_vendor ??= e.uses_vendor;
      same.funding = [...new Set([...same.funding, ...e.funding])];
    }
  }
  return { agenda, action_items, mentioned_dates, budget, events: merged };
}

const TEMPLATE_WORDS: [A2Output["tasks"][number]["template_key"], RegExp][] = [
  ["PLN_DRAFT", /기획안\s*(초안|작성)/],
  ["FIN_BUDGET_RANGE", /예산\s*(범위|시나리오)/],
  ["PRO_MAKE", /(카드뉴스|포스터|홍보물|현수막).*(제작)/],
  ["PRO_PUBLISH", /(게시|배포)/],
  ["OPS_MANUAL", /매뉴얼/],
  ["FIN_PURCHASE_LIST", /구입\s*리스트/],
  ["SEC_PARTNER_LIST", /제휴.*(후보|리스트)/],
];

export function mockA2(ctx: A2MockContext): A2Output {
  const { summary, projects } = ctx;
  const norm = (s: string) => s.replace(/\s|\(.*?\)/g, "");
  const out: A2Output = { projects: [], tasks: [] };
  summary.events.forEach((e, i) => {
    const existing = projects.find((p) => norm(p.title).includes(norm(e.title)) || norm(e.title).includes(norm(p.title)));
    out.projects.push({
      ref: `P${i + 1}`,
      existing_project_id: existing?.id ?? null,
      title: e.title,
      category: "event",
      event_start: e.date,
      venue: e.venue,
      beneficiaries: e.beneficiaries,
      funding: e.funding,
      uses_vendor: e.uses_vendor,
      evidence: [{ para: e.para, quote: e.quote }],
      confidence: 0.6,
    });
  });
  const agendaOf = (para: number) => [...summary.agenda].reverse().find((a) => a.para <= para);
  for (const a of summary.action_items) {
    const ag = agendaOf(a.para);
    let evIdx = ag ? summary.events.findIndex((e) => e.para === ag.para) : -1;
    if (evIdx < 0) {
      // 업무 문구에 행사 이름의 핵심 단어가 있으면 그 사업의 업무로 본다(예: "간식 행사 카드뉴스 제작" → "종강 간식 행사")
      evIdx = summary.events.findIndex((e) => e.title.split(/\s+/).some((w) => w.length >= 2 && !GENERIC.has(w) && a.what.includes(w)));
    }
    const proj = evIdx >= 0 ? out.projects[evIdx]! : null;
    const tk = TEMPLATE_WORDS.find(([, re]) => re.test(a.what))?.[0] ?? null;
    out.tasks.push({
      project_ref: proj ? (proj.existing_project_id ?? proj.ref) : null,
      title: a.what.length > 60 ? `${a.what.slice(0, 57)}…` : a.what,
      description: null,
      lead_department: a.department ?? guessDept(a.what) ?? "secretariat",
      support_departments: [],
      template_key: tk,
      assignee_hint: a.who,
      due_date: a.due_date,
      inferred: false,
      inference_reason: null,
      evidence: [{ para: a.para, quote: a.quote }],
      confidence: 0.6,
    });
  }
  return out;
}

export type A6MockContext = { criteria: string[]; text: string | null; image: boolean };

/** 결정적 A6: 기준 낱말이 추출 텍스트에 있으면 충족, 일부면 부분. 이미지는 '부분'(mock 은 그림을 못 본다) */
export function mockA6(ctx: A6MockContext): A6Output {
  const text = (ctx.text ?? "").replace(/\s+/g, "");
  const criteria = ctx.criteria.map((c) => {
    const words = c.split(/[·,()\s/]+/).map((w) => w.replace(/(필요시|여부|없음)$/g, "")).filter((w) => w.length >= 2);
    const hit = words.filter((w) => text.includes(w)).length;
    const verdict = ctx.image ? "partial" : words.length && hit === words.length ? "met" : hit > 0 ? "partial" : "unmet";
    return { criterion: c, verdict: verdict as "met" | "partial" | "unmet", evidence: ctx.image ? "mock 평가: 이미지는 내용을 확인하지 않음" : hit ? `작업물에 '${words.filter((w) => text.includes(w)).join("·")}' 언급` : "작업물에서 찾지 못함" };
  });
  const pts = criteria.reduce((n, c) => n + (c.verdict === "met" ? 1 : c.verdict === "partial" ? 0.5 : 0), 0);
  const score = Math.max(1, Math.round((pts / Math.max(1, criteria.length)) * 100));
  return {
    criteria,
    score,
    missing_items: criteria.filter((c) => c.verdict !== "met").map((c) => c.criterion),
    suggestions: criteria.filter((c) => c.verdict === "unmet").map((c) => `'${c.criterion}' 항목을 추가하세요.`),
    summary: `mock 평가: 기준 ${criteria.length}개 중 충족 ${criteria.filter((c) => c.verdict === "met").length}개`,
  };
}

export const MOCK_HANDLERS: Record<string, MockHandler> = {
  a6: (req: CompleteRequest) => mockA6(req.mockContext as A6MockContext),
  a1: (req: CompleteRequest) => mockA1(req.mockContext as A1MockContext),
  a2: (req: CompleteRequest) => mockA2(req.mockContext as A2MockContext),
};
