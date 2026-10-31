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
export function guessTemplate(text: string): TemplateKey | null {
  for (const [k, re] of KEYWORDS) if (re.test(text)) return k;
  return null;
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
    title: string; description: string | null; lead: string; support: string[]; template_key: string | null; assignee_hint: string | null;
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
    const criteria = t.template_key ? TEMPLATES[t.template_key as TemplateKey].criteria.map((text) => ({ text, done: false })) : [];
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
      // 표준 업무 키가 없어도 업무명(기획안·홍보물·매뉴얼 등)으로 규칙 엔진 마감을 찾는다 — 마감 빈칸 방지
      const tk = t.template_key ?? guessTemplate(`${t.title} ${t.description ?? ""}`);
      const s = tk && schedule ? schedule.tasks.find((x) => x.key === tk) : undefined;
      const fromMinutes = t.due_date && t.due_date >= today;
      pushTask(key, shape, {
        title: t.title, description: t.description, lead: t.lead_department, support: t.support_departments, template_key: t.template_key, assignee_hint: t.assignee_hint,
        due: fromMinutes ? t.due_date : s?.due ?? null,
        due_reason: fromMinutes ? `회의록에 명시된 기한(¶${t.evidence[0]?.para ?? "?"})` : s?.reason ?? null,
        due_feasible: fromMinutes ? true : s?.feasible ?? true,
        evidence: t.evidence, inferred: t.inferred, inference_reason: t.inference_reason, confidence: t.confidence,
      });
    }
  }

  // 행사 사업: 회의록에 없던 표준 업무를 '추론' 제안으로 덧붙임 (D8 — 기본 체크 해제)
  for (const shape of shapes.values()) {
    if (!shape.event_start) continue;
    const schedule = computeSchedule({ eventStart: shape.event_start, today, funding: shape.funding, usesVendor: shape.usesVendor, params }, false);
    const mentioned = new Set((tasksByProject.get(shape.key) ?? []).map((t) => t.template_key).filter(Boolean));
    for (const def of templateFor({ funding: shape.funding, usesVendor: shape.usesVendor })) {
      if (mentioned.has(def.key)) continue;
      const s = schedule.tasks.find((x) => x.key === def.key)!;
      pushTask(shape.key, shape, {
        title: def.title, description: null, lead: def.lead, support: def.support, template_key: def.key, assignee_hint: null,
        due: s.due, due_reason: s.reason, due_feasible: s.feasible, evidence: [],
        inferred: true, inference_reason: `표준 업무 템플릿(지시서 5-2)${shape.funding.includes("student_fee") && ["OPS_EVIDENCE", "FIN_EVIDENCE"].includes(def.key) ? " — 학생회비 증빙 규칙" : ""}`,
        confidence: 0.5,
      });
    }
  }
  // 회의록 액션아이템이 빠짐없이 업무가 되었는지 확인 → 빠진 것은 회의록 근거 업무로 추가
  const allTasksOf = (key: string | null) => [
    ...rows.filter((r) => r.kind === "new_task" && r.project_key === key).map((r) => (r.payload as { title: string; template_key: string | null }) ),
    ...(key ? shapes.get(key)?.existingTasks ?? [] : []),
  ];
  const onlyProject = shapes.size === 1 ? [...shapes.values()][0]! : null;
  for (const ai of input.actionItems ?? []) {
    if (!ai.what?.trim() || !ai.department) continue;
    const key = onlyProject?.key ?? null;
    const tpl = guessTemplate(ai.what);
    const fromMinutes = ai.due_date && ai.due_date >= today ? ai.due_date : null;
    const sameAs = (x: { title: string; template_key: string | null }) => similarity(x.title, ai.what) >= 0.45 || Boolean(tpl && x.template_key === tpl && !/여러|버전|검토/.test(ai.what));
    // 표준 템플릿으로 '추론' 추가된 업무가 회의록에 실제로 나오면 → 회의록 근거 업무로 올림(기본 체크, 근거 문단 표시)
    const inferredRow = rows.find((r) => r.kind === "new_task" && r.project_key === key && r.inferred && sameAs(r.payload as { title: string; template_key: string | null }));
    if (inferredRow) {
      const pl = inferredRow.payload as Record<string, unknown>;
      inferredRow.inferred = false;
      inferredRow.inference_reason = null;
      inferredRow.confidence = 0.8;
      inferredRow.evidence = [{ para: ai.para, quote: ai.quote }] as Prisma.InputJsonValue;
      if (fromMinutes) inferredRow.payload = { ...pl, due_date: fromMinutes, due_reason: `회의록에 명시된 기한(¶${ai.para})`, due_feasible: true } as Prisma.InputJsonValue;
      continue;
    }
    const pool = allTasksOf(key);
    const match = pool.some(sameAs) || covered.some((c) => similarity(c, ai.what) >= 0.6);
    if (match) continue;
    const sched = onlyProject?.event_start && tpl ? computeSchedule({ eventStart: onlyProject.event_start, today, funding: onlyProject.funding, usesVendor: onlyProject.usesVendor, params }, false).tasks.find((x) => x.key === tpl) : undefined;
    pushTask(key, onlyProject, {
      title: ai.what.slice(0, 150), description: null, lead: ai.department, support: [], template_key: null, assignee_hint: null,
      due: fromMinutes ?? sched?.due ?? null,
      due_reason: fromMinutes ? `회의록에 명시된 기한(¶${ai.para})` : sched?.reason ?? null,
      due_feasible: fromMinutes ? true : sched?.feasible ?? true,
      evidence: [{ para: ai.para, quote: ai.quote }], inferred: false, inference_reason: null, confidence: 0.7,
    });
  }
  return rows;
}

