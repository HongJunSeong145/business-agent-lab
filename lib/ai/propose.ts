import { createHash } from "node:crypto";
import type { Prisma } from "@/lib/generated/prisma/client";
import { computeSchedule, TEMPLATES, templateFor, type FundingSource, type RuleParams, type TemplateKey } from "@kgb/rules";
import type { A2Output } from "./schemas/a2";

/**
 * A2 결과 + 규칙 엔진(A3 마감 역산, A4 재원별 필수 업무) → proposals 행 (6-2, 6-4, D8·D9).
 *  - 회의록 근거가 있는 항목은 inferred=false, 템플릿에서 덧붙인 항목은 inferred=true(검토 화면에서 기본 체크 해제)
 *  - 마감: 회의록에 명시된 기한 > 규칙 엔진 계산값 (충돌 해소 우선순위 6-4)
 *  - dedupe_key = 해시(source_id + kind + 정규화 제목 + 사업키)
 *  - 기존 사업과 같은 사업이면 새로 만들지 않고 변경 제안(before → after)만 (D9)
 */
export type ExistingProject = {
  id: string;
  title: string;
  event_start: string | null;
  venue: string | null;
  expected_beneficiaries: number | null;
  uses_external_vendor: boolean;
  funding: FundingSource[];
  tasks: ExistingTask[];
};
export type ExistingTask = {
  id?: string; title: string; template_key: string | null; due?: string | null; lead?: string | null; done?: boolean;
  /** 이 업무를 만든 회의록 — 같은 회의록 재분석이면 사람이 정한 마감을 되돌리는 제안을 하지 않는다 */
  fromMeeting?: string | null;
};
/** A1 액션아이템(누가·무엇을·언제) — 빠짐없이 업무가 되었는지 코드가 확인한다 */
export type ActionItem = { department: string | null; what: string; due_date: string | null; para: number; quote: string };

/** 글자 두 개씩 묶어 비교한 유사도(0~1) — 띄어쓰기·괄호 무시 */
export function similarity(a: string, b: string): number {
  const bg = (x: string) => {
    const t = normTitle(x);
    const out: string[] = [];
    for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
    return out;
  };
  const A = bg(a);
  const B = bg(b);
  if (!A.length || !B.length) return 0;
  const pool = [...B];
  let hit = 0;
  for (const x of A) {
    const k = pool.indexOf(x);
    if (k >= 0) (hit++, pool.splice(k, 1));
  }
  return (2 * hit) / (A.length + B.length);
}

/** 업무 문장 → 표준 업무 키 추정(같은 일을 다른 말로 쓴 경우 연결) */
const KEYWORDS: [TemplateKey, RegExp][] = [
  ["OPS_MANUAL", /매뉴얼|메뉴얼/],
  ["PLN_APPROVAL", /결재/],
  ["PLN_DRAFT", /기획안/],
  ["PRO_TIER", /홍보.*등급|등급.*홍보/],
  ["PRO_PUBLISH", /게시|배포/],
  ["PRO_MAKE", /홍보물|카드뉴스|포스터|현수막/],
  ["FIN_PURCHASE_LIST", /구입\s*리스트|구매\s*목록|구입\s*목록/],
  ["FIN_PURCHASE", /구입\s*진행|구매\s*진행|최종\s*구입/],
  ["FIN_BUDGET_RANGE", /예산\s*(범위|시나리오)/],
  ["VENDOR_CONFIRM", /견적|대행사|업체\s*확정/],
  ["SEC_PARTNER_LIST", /제휴.*(후보|리스트)/],
  ["SEC_PROPOSAL", /제휴\s*요청서|요청서/],
  ["OPS_EVIDENCE", /사진|수혜자\s*명단/],
];
export function guessTemplate(text: string, lead?: string | null): TemplateKey | null {
  // 주관 국서가 정해져 있으면 그 국서의 업무 종류만(예: 재정국 업무 설명에 '기획안'이 나와도 기획안 마감을 쓰지 않음)
  for (const [k, re] of KEYWORDS) if (re.test(text) && (!lead || TEMPLATES[k].lead === lead)) return k;
  return null;
}

/** 업무 문장 → 맡을 국서 추정(주어 없는 "~작성요망" 문장용, 국서 역할 기준) */
const DEPT_WORDS: [string, RegExp][] = [
  ["operations", /매뉴얼|메뉴얼|현장|인력|당일\s*집행|동선/],
  ["promotion", /홍보|카드뉴스|포스터|현수막/],
  ["planning", /기획안|기획/],
  ["finance", /예산|영수|증빙|구입|구매|정산|결산|업체.*가격|가격/],
  ["secretariat", /제휴|요청서|문의|공문/],
];
export function guessDept(text: string): string | null {
  for (const [d, re] of DEPT_WORDS) if (re.test(text)) return d;
  return null;
}

/** part 의 글자쌍이 text 안에 얼마나 들어 있나(0~1) — 업무 설명·체크리스트에 회의록 항목이 담겼는지 */
export function contains(text: string, part: string): number {
  const bg = (x: string) => {
    const t = normTitle(x);
    const out: string[] = [];
    for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
    return out;
  };
  const P = bg(part);
  if (!P.length) return 0;
  const pool = bg(text);
  let hit = 0;
  for (const x of P) {
    const k = pool.indexOf(x);
    if (k >= 0) (hit++, pool.splice(k, 1));
  }
  return hit / P.length;
}

/** 회의록 문장 → 업무명: 끝의 요청 표현을 떼고 다듬는다("행사당일 집행매뉴얼 작성요망" → "행사 당일 집행매뉴얼 작성") */
export function taskTitleFrom(what: string): string {
  let t = what.trim().replace(/[.。]+$/, "");
  t = t.replace(/\s*(작성|제작|준비|검토|보고)?\s*(요망|필요함?|바람|할\s*것|해\s*올릴\s*것|해\s*주세요|되었으면\s*좋겠음|했으면\s*좋겠음|하기로\s*함)$/, (_m, verb: string | undefined) => (verb ? ` ${verb}` : ""));
  t = t.replace(/행사당일/g, "행사 당일").replace(/\s{2,}/g, " ").trim();
  return (t || what).slice(0, 150);
}

export type Member = { id: string; name: string };

export const normTitle = (s: string) => s.replace(/[\s()\[\]·,.\-–_:]/g, "").toLowerCase();

export function dedupeKey(sourceId: string, kind: string, title: string, projectKey: string | null): string {
  return createHash("sha256").update([sourceId, kind, normTitle(title), projectKey ?? "-"].join("|")).digest("hex");
}

type Row = Omit<Prisma.ProposalUncheckedCreateInput, "term_id" | "source_type" | "source_id">;

export function buildProposals(input: {
  meetingId: string;
  a2: A2Output;
  existing: ExistingProject[];
  members: Member[];
  params: RuleParams;
  today: string;
  /** A1 액션아이템 — 업무로 빠짐없이 옮겨졌는지 확인(빠진 것은 회의록 근거 업무로 추가) */
  actionItems?: ActionItem[];
}): Row[] {
  const { meetingId, a2, existing, params, today } = input;
  const rows: Row[] = [];
  const covered: string[] = []; // 업무로 옮겨진(또는 기존 업무와 연결된) 제목
  const projectKeyOf = new Map<string, string>(); // a2 ref/id → project_key
  type ProjShape = { key: string; existingId: string | null; title: string; event_start: string | null; funding: FundingSource[]; usesVendor: boolean; existingTasks: ExistingTask[] };
  const shapes = new Map<string, ProjShape>();

  for (const p of a2.projects) {
    const ex = p.existing_project_id ? existing.find((e) => e.id === p.existing_project_id) : existing.find((e) => normTitle(e.title) === normTitle(p.title));
    if (ex) {
      projectKeyOf.set(p.ref, ex.id);
      projectKeyOf.set(ex.id, ex.id);
      const after: Record<string, unknown> = {};
      const before: Record<string, unknown> = {};
      const cmp = (k: string, a: unknown, b: unknown) => {
        if (b !== null && b !== undefined && JSON.stringify(a) !== JSON.stringify(b)) {
          before[k] = a;
          after[k] = b;
        }
      };
      cmp("event_start", ex.event_start, p.event_start);
      cmp("venue", ex.venue, p.venue);
      cmp("expected_beneficiaries", ex.expected_beneficiaries, p.beneficiaries);
      cmp("uses_external_vendor", ex.uses_external_vendor, p.uses_vendor);
      if (p.funding.length) cmp("funding", [...ex.funding].sort(), [...p.funding].sort());
      if (Object.keys(after).length) {
        rows.push({
          kind: "update_project", target_id: ex.id, project_key: ex.id,
          payload: { title: ex.title, changes: after } as Prisma.InputJsonValue,
          before_snapshot: before as Prisma.InputJsonValue,
          evidence: p.evidence as Prisma.InputJsonValue, inferred: false, confidence: p.confidence,
          dedupe_key: dedupeKey(meetingId, "update_project", ex.title, ex.id),
        });
      }
      shapes.set(ex.id, {
        key: ex.id, existingId: ex.id, title: ex.title,
        event_start: (after.event_start as string) ?? ex.event_start,
        funding: (after.funding as FundingSource[]) ?? ex.funding,
        usesVendor: (after.uses_external_vendor as boolean) ?? ex.uses_external_vendor,
        existingTasks: ex.tasks,
      });
    } else {
      const key = `${meetingId}:${p.ref}`;
      projectKeyOf.set(p.ref, key);
      const payload = {
        title: p.title, category: p.category, event_start: p.event_start, venue: p.venue, expected_beneficiaries: p.beneficiaries,
        funding: p.funding, uses_external_vendor: p.uses_vendor ?? false,
      };
      rows.push({
        kind: "new_project", project_key: key, payload: payload as Prisma.InputJsonValue,
        evidence: p.evidence as Prisma.InputJsonValue, inferred: false, confidence: p.confidence,
        dedupe_key: dedupeKey(meetingId, "new_project", p.title, key),
      });
      shapes.set(key, { key, existingId: null, title: p.title, event_start: p.event_start, funding: p.funding, usesVendor: p.uses_vendor ?? false, existingTasks: [] });
    }
  }

  // 담당자(사람)는 추천하지 않는다 — 국장이 국서 워크스페이스에서 직접 정한다(사용자 결정 2026-10-31)

  // 사업별 업무 (AI 업무 + 표준 템플릿)
  const tasksByProject = new Map<string | null, A2Output["tasks"]>();
  for (const t of a2.tasks) {
    const key = t.project_ref ? projectKeyOf.get(t.project_ref) ?? (existing.some((e) => e.id === t.project_ref) ? t.project_ref : null) : null;
    if (key && !shapes.has(key)) {
      const ex = existing.find((e) => e.id === key)!;
      shapes.set(key, { key, existingId: ex.id, title: ex.title, event_start: ex.event_start, funding: ex.funding, usesVendor: ex.uses_external_vendor, existingTasks: ex.tasks });
    }
    tasksByProject.set(key, [...(tasksByProject.get(key) ?? []), t]);
  }

  const pushTask = (key: string | null, shape: ProjShape | null, t: {
    title: string; description: string | null; lead: string; support: string[]; template_key: string | null; assignee_hint: string | null; checklist?: string[];
    due: string | null; due_reason: string | null; due_feasible: boolean; evidence: unknown; inferred: boolean; inference_reason: string | null; confidence: number;
  }) => {
    // 이미 있는 업무: 새로 만들지 않는다. 회의록에 다른 마감이 명시돼 있으면 '업무 변경(마감)' 제안으로 연결
    const same = shape?.existingTasks.find((x) => normTitle(x.title) === normTitle(t.title) || (t.template_key && x.template_key === t.template_key) || similarity(x.title, t.title) >= 0.6);
    if (same) {
      covered.push(t.title);
      if (same.id && !same.done && same.fromMeeting !== meetingId && t.due && t.due_reason?.startsWith("회의록") && t.due !== same.due) {
        rows.push({
          kind: "update_task", project_key: key, target_id: same.id,
          payload: { title: same.title, changes: { due_date: t.due }, reason: `${t.due_reason} — 회의록: ${t.title}` } as Prisma.InputJsonValue,
          before_snapshot: { due_date: same.due ?? null } as Prisma.InputJsonValue,
          evidence: t.evidence as Prisma.InputJsonValue, inferred: false, confidence: t.confidence,
          dedupe_key: dedupeKey(meetingId, "update_task", same.title, key),
        });
      }
      return;
    }
    covered.push(t.title);
    // 완료 기준: AI 가 회의록에서 뽑은 세부 항목 → 없으면 같은 종류 업무의 기본 기준
    const criteria = t.checklist?.length
      ? t.checklist.map((text) => ({ text, done: false }))
      : t.template_key ? TEMPLATES[t.template_key as TemplateKey].criteria.map((text) => ({ text, done: false })) : [];
    rows.push({
      kind: "new_task",
      project_key: key,
      target_id: shape?.existingId ?? null,
      payload: {
        title: t.title, description: t.description, lead_department: t.lead, support_departments: t.support.filter((s) => s !== t.lead),
        template_key: t.template_key, assignee_ids: [],
        due_date: t.due, due_reason: t.due_reason, due_feasible: t.due_feasible, acceptance_criteria: criteria,
        project_id: shape?.existingId ?? null, project_title: shape?.title ?? null,
      } as Prisma.InputJsonValue,
      evidence: t.evidence as Prisma.InputJsonValue,
      inferred: t.inferred,
      inference_reason: t.inference_reason,
      confidence: t.confidence,
      dedupe_key: dedupeKey(meetingId, "new_task", t.title, key),
    });
  };

  for (const [key, list] of tasksByProject) {
    const shape = key ? shapes.get(key) ?? null : null;
    const schedule = shape?.event_start
      ? computeSchedule({ eventStart: shape.event_start, today, funding: shape.funding, usesVendor: shape.usesVendor, params }, false)
      : null;
    for (const t of list) {
      // 마감 우선순위: ① 회의록에 적힌 기한 ② 회의록 행사일·선후관계로 AI 가 거꾸로 계산한 날짜(근거 표시) ③ 규칙 엔진(업무 종류로 추정)
      const tk = t.template_key ?? guessTemplate(t.title, t.lead_department);
      const s = tk && schedule ? schedule.tasks.find((x) => x.key === tk) : undefined;
      const valid = Boolean(t.due_date && t.due_date >= today && (!shape?.event_start || t.due_date <= shape.event_start));
      const basis = valid ? (t.due_basis ?? "minutes") : null;
      const para = t.evidence[0]?.para ?? "?";
      // 업무 종류를 추정했고 이 사업에 같은 종류 업무가 아직 없으면 키를 붙인다(선후관계·기획안 결재 시 완료·결재본 기준 마감 재계산에 쓰임)
      const taken = (k: string) => (shape?.existingTasks ?? []).some((x) => x.template_key === k) || rows.some((r) => r.project_key === key && (r.payload as { template_key?: string | null }).template_key === k);
      const keyToSave = t.template_key ?? (tk && key && !taken(tk) ? tk : null);
      pushTask(key, shape, {
        title: t.title, description: t.description, lead: t.lead_department, support: t.support_departments, template_key: keyToSave, assignee_hint: t.assignee_hint,
        checklist: t.checklist ?? [],
        due: basis ? t.due_date : s?.due ?? null,
        due_reason:
          basis === "minutes"
            ? `회의록에 명시된 기한(¶${para})${t.due_reason ? ` — ${t.due_reason}` : ""}`
            : basis === "reasoned"
              ? `역산(AI): ${t.due_reason ?? "회의록 행사일·선후관계 기준"}`
              : s?.reason ?? null,
        due_feasible: basis ? true : s?.feasible ?? true,
        evidence: t.evidence, inferred: t.inferred, inference_reason: t.inference_reason, confidence: t.confidence,
      });
    }
  }

  // 표준 업무 템플릿을 업무로 덧붙이지 않는다(사용자 결정 2026-10-31 — 국서 역할은 판단 기준일 뿐, 회의록에 나온 일만 업무로).

  // 회의록 액션아이템이 빠짐없이 업무가 되었는지 확인 → 빠진 것은 회의록 근거 업무로 추가
  const textOf = (r: Row) => {
    const p = r.payload as { title: string; description?: string | null; acceptance_criteria?: { text: string }[] };
    return `${p.title} ${p.description ?? ""} ${(p.acceptance_criteria ?? []).map((c) => c.text).join(" ")}`;
  };
  const onlyProject = shapes.size === 1 ? [...shapes.values()][0]! : null;
  for (const ai of input.actionItems ?? []) {
    if (!ai.what?.trim()) continue;
    const dept = ai.department ?? guessDept(`${ai.what} ${ai.quote}`);
    if (!dept) continue;
    const key = onlyProject?.key ?? null;
    const tpl = guessTemplate(ai.what, dept);
    const mine = rows.filter((r) => r.kind === "new_task" && r.project_key === key);
    const existingTasks = key ? shapes.get(key)?.existingTasks ?? [] : [];
    // 같은 국서·같은 결과물(업무 종류)이면 하나의 업무로 본다 — 세부 문장은 그 업무의 설명·체크리스트에 담긴다
    const covers = (text: string, title: string, template: string | null, lead: string | null | undefined) =>
      similarity(title, ai.what) >= 0.45 || contains(text, ai.what) >= 0.6 || Boolean(tpl && (template ?? guessTemplate(title, lead)) === tpl);
    const match =
      mine.some((r) => {
        const p = r.payload as { title: string; template_key: string | null; lead_department: string };
        return covers(textOf(r), p.title, p.template_key, p.lead_department);
      }) ||
      existingTasks.some((x) => covers(x.title, x.title, x.template_key, x.lead)) ||
      covered.some((c) => similarity(c, ai.what) >= 0.6);
    if (match) continue;
    const fromMinutes = ai.due_date && ai.due_date >= today && (!onlyProject?.event_start || ai.due_date <= onlyProject.event_start) ? ai.due_date : null;
    const sched = onlyProject?.event_start && tpl ? computeSchedule({ eventStart: onlyProject.event_start, today, funding: onlyProject.funding, usesVendor: onlyProject.usesVendor, params }, false).tasks.find((x) => x.key === tpl) : undefined;
    const tplFree = tpl && key && !existingTasks.some((x) => x.template_key === tpl) && !mine.some((r) => (r.payload as { template_key?: string | null }).template_key === tpl) ? tpl : null;
    pushTask(key, onlyProject, {
      title: taskTitleFrom(ai.what), description: ai.what !== taskTitleFrom(ai.what) ? `회의록: "${ai.quote || ai.what}"` : null, lead: dept, support: [], template_key: tplFree, assignee_hint: null,
      due: fromMinutes ?? sched?.due ?? null,
      due_reason: fromMinutes ? `회의록에 명시된 기한(¶${ai.para})` : sched?.reason ?? null,
      due_feasible: fromMinutes ? true : sched?.feasible ?? true,
      evidence: [{ para: ai.para, quote: ai.quote }], inferred: false, inference_reason: null, confidence: 0.7,
    });
  }
  return rows;
}

