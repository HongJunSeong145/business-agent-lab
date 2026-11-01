import { addDays, md, prevWorkday, toDays } from "./dates";
import { minDuration, type DurationKey, type RuleParams } from "./params";
import type { FundingSource } from "./funding";
import type { PromoTier } from "./promo";
import { templateFor, type TemplateKey } from "./templates";

/**
 * 마감일 역산 (5-3, D6, ADR-014). 결정적 규칙 — 같은 입력이면 같은 일정(D16).
 *  - 고정 앵커: 행정실 송부 = D-21(교비), 업체 확정 ≤ 송부 - 7, 홍보 게시 ≤ D-7, 집행 매뉴얼 ≤ D-7, 최종 구입 ≤ D-3
 *  - 역방향 패스(최종 마감 LF), 순방향 패스(가장 빠른 시작 ES), ES + 소요 > LF 이면 불가(infeasible)
 *  - 토·일·휴일 마감은 직전 평일로 당김(행사일 자체는 그대로)
 *  - 불가해도 과거 날짜를 만들거나 몰래 압축하지 않고 대안 4종을 계산한다
 *  - 사용자가 확정한 마감(fixed)은 바꾸지 않고 제약으로만 쓴다(5-3 ⑨)
 */
export type ScheduleInput = {
  eventStart: string;
  eventEnd?: string | null;
  today: string;
  funding: readonly FundingSource[];
  usesVendor: boolean;
  /** 미정이면 저비용으로 가정(N5) */
  promoTier?: PromoTier | null;
  params: RuleParams;
  /** 사용자가 확정한 마감 */
  fixed?: Partial<Record<TemplateKey, string>>;
  /** 이미 완료된 업무 — 시작 제약에서 제외 */
  done?: readonly TemplateKey[];
  /** 대안 (a) 계산용 */
  compress?: boolean;
};

export type ScheduledTask = {
  key: TemplateKey;
  /** 추천(또는 확정) 마감 — 불가하고 이미 지난 날짜면 null (과거 날짜 미생성) */
  due: string | null;
  /** 규칙상 최종 마감(제약 계산값, 과거일 수 있음) */
  latest: string;
  earliestStart: string;
  duration: number;
  feasible: boolean;
  fixed: boolean;
  reason: string;
};

export type Milestone = { key: "SCHOOL_SUBMIT"; title: string; date: string | null; latest: string; feasible: boolean; reason: string };

export type Alternatives = {
  /** (a) 최소 소요일로 압축하면 가능한지 */
  compress: boolean;
  /** (b) 교비 → 학생회비 전환 시 가능한지 (교비 사업만) */
  toStudentFee: boolean | null;
  /** (c) 같은 조건으로 가능한 가장 빠른 행사일 (1년 안에 없으면 null) */
  earliestEventDate: string | null;
  /** (d) 외부업체 없이 진행 시 가능한지 (외부업체 사업만) */
  withoutVendor: boolean | null;
};

export type ScheduleResult = {
  tasks: ScheduledTask[];
  milestones: Milestone[];
  feasible: boolean;
  alternatives: Alternatives | null;
};

type Node = { key: TemplateKey | "SCHOOL_SUBMIT"; duration: number; title: string };

function durationOf(key: TemplateKey, input: ScheduleInput): number {
  const p = input.params;
  const base = key === "PRO_MAKE" ? p.PROMO_DURATIONS[input.promoTier ?? "low"] : p.DEFAULT_DURATIONS[key as DurationKey];
  return input.compress ? minDuration(base) : base;
}

export function computeSchedule(input: ScheduleInput, withAlternatives = true): ScheduleResult {
  const holidays = new Set(input.params.HOLIDAYS);
  const D = input.eventStart;
  const end = input.eventEnd && input.eventEnd > D ? input.eventEnd : D;
  const today = input.today;
  const p = input.params;
  const school = input.funding.includes("school");
  const defs = templateFor({ funding: input.funding, usesVendor: input.usesVendor });
  const pre = defs.filter((d) => d.phase === "pre");
  const fixed = input.fixed ?? {};
  const done = new Set(input.done ?? []);

  // ── 그래프: 행사 전 업무 + 교비 송부 마일스톤 ──
  const nodes = new Map<string, Node>();
  for (const d of pre) nodes.set(d.key, { key: d.key, duration: durationOf(d.key, input), title: d.title });
  const preds = new Map<string, { key: string; type: string }[]>();
  for (const d of pre) preds.set(d.key, d.deps.filter((x) => nodes.has(x.key)));
  if (school) {
    nodes.set("SCHOOL_SUBMIT", { key: "SCHOOL_SUBMIT", duration: 1, title: "공문·기획안 행정실 송부" });
    preds.set("SCHOOL_SUBMIT", [{ key: "PLN_APPROVAL", type: "finish_to_start" }, ...(nodes.has("VENDOR_CONFIRM") ? [{ key: "VENDOR_CONFIRM", type: "finish_to_start" }] : [])]);
  }
  const succs = new Map<string, { key: string; type: string }[]>();
  for (const [k, ps] of preds) for (const x of ps) succs.set(x.key, [...(succs.get(x.key) ?? []), { key: k, type: x.type }]);

  // 위상 정렬 (템플릿은 비순환)
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (k: string) => {
    if (seen.has(k)) return;
    seen.add(k);
    for (const x of preds.get(k)!) visit(x.key);
    order.push(k);
  };
  [...nodes.keys()].forEach(visit);

  // ── 앵커 ──
  const submit = school ? prevWorkday(addDays(D, -p.SCHOOL_SUBMIT_LEAD_DAYS), holidays) : null;
  const anchors = new Map<string, { date: string; reason: string }>();
  if (submit) anchors.set("SCHOOL_SUBMIT", { date: submit, reason: `교비 사업: 행사일(${md(D)}) ${p.SCHOOL_SUBMIT_LEAD_DAYS}일 전 행정실 송부` });
  if (submit && nodes.has("VENDOR_CONFIRM")) {
    anchors.set("VENDOR_CONFIRM", { date: addDays(submit, -p.VENDOR_CONFIRM_BUFFER_DAYS), reason: `외부업체 확정: 행정실 송부(${md(submit)}) ${p.VENDOR_CONFIRM_BUFFER_DAYS}일 전` });
  }
  anchors.set("PRO_PUBLISH", { date: addDays(D, -p.PROMO_PUBLISH_LATEST_DAYS), reason: `홍보물 게시: 늦어도 행사 ${p.PROMO_PUBLISH_LATEST_DAYS}일 전` });
  anchors.set("OPS_MANUAL", { date: addDays(D, -p.OPS_MANUAL_LATEST_DAYS), reason: `집행 매뉴얼: 늦어도 행사 ${p.OPS_MANUAL_LATEST_DAYS}일 전` });
  anchors.set("FIN_PURCHASE", { date: addDays(D, -p.PURCHASE_LATEST_DAYS), reason: `최종 구입: 늦어도 행사 ${p.PURCHASE_LATEST_DAYS}일 전` });

  // ── 역방향 패스 ──
  const LF = new Map<string, string>();
  const reason = new Map<string, string>();
  for (const k of [...order].reverse()) {
    const n = nodes.get(k)!;
    const fixedDate = k !== "SCHOOL_SUBMIT" ? fixed[k as TemplateKey] : undefined;
    if (fixedDate) {
      LF.set(k, fixedDate);
      reason.set(k, "사용자 확정");
      continue;
    }
    let best = addDays(D, -1);
    let why = `행사(${md(D)}) 전날까지`;
    const a = anchors.get(k);
    if (a && a.date <= best) {
      best = a.date;
      why = a.reason;
    }
    for (const s of succs.get(k) ?? []) {
      const sn = nodes.get(s.key)!;
      const sLF = LF.get(s.key)!;
      const fs = addDays(sLF, -sn.duration);
      const cand = s.type === "draft_ok" ? (addDays(fs, n.duration) < sLF ? addDays(fs, n.duration) : sLF) : fs;
      if (cand < best) {
        best = cand;
        why = s.key === "SCHOOL_SUBMIT" ? `행정실 송부(${md(sLF)}) 전` : s.type === "draft_ok" ? `'${sn.title}' 업무와 겹쳐 진행, 그보다 먼저 끝냄` : `후속 '${sn.title}'(소요 ${sn.duration}일) 착수 전`;
      }
    }
    // 마일스톤(송부일)은 앵커 자체가 이미 평일로 보정됨
    const adjusted = prevWorkday(best, holidays);
    if (adjusted !== best) why += " (토·일·휴일이라 직전 평일로 당김)";
    LF.set(k, adjusted);
    reason.set(k, `${why} → ${md(adjusted)}`);
  }

  // ── 순방향 패스 ──
  const ES = new Map<string, string>();
  const EF = new Map<string, string>();
  for (const k of order) {
    const n = nodes.get(k)!;
    if (done.has(k as TemplateKey)) {
      ES.set(k, today);
      EF.set(k, today);
      continue;
    }
    let es = today;
    for (const x of preds.get(k)!) {
      const c = x.type === "draft_ok" ? (() => {
        const a = ES.get(x.key)!;
        const b = addDays(EF.get(x.key)!, -n.duration);
        return a > b ? a : b;
      })() : EF.get(x.key)!;
      if (c > es) es = c;
    }
    ES.set(k, es);
    EF.set(k, addDays(es, n.duration));
  }

  const isFeasible = (k: string) => done.has(k as TemplateKey) || (EF.get(k)! <= LF.get(k)! && LF.get(k)! >= today);
  const tasks: ScheduledTask[] = [];
  for (const d of defs) {
    if (d.phase === "pre") {
      const k = d.key;
      const lf = LF.get(k)!;
      const ok = isFeasible(k);
      const isFixed = Boolean(fixed[k]);
      tasks.push({
        key: k,
        due: isFixed ? lf : lf >= today ? lf : null,
        latest: lf,
        earliestStart: ES.get(k)!,
        duration: nodes.get(k)!.duration,
        feasible: ok,
        fixed: isFixed,
        reason: ok ? reason.get(k)! : `${reason.get(k)!} — 일정 불가: 오늘 시작해도 ${nodes.get(k)!.duration}일이 걸려 ${md(EF.get(k)!)}에 끝남`,
      });
    } else {
      const due = d.key === "OPS_EXECUTE" ? end : d.key === "OPS_EVIDENCE" ? addDays(end, p.EVIDENCE_PHOTO_GRACE_DAYS) : addDays(end, 7);
      const why = d.key === "OPS_EXECUTE" ? `행사 당일(${md(end)})` : d.key === "OPS_EVIDENCE" ? `행사 후 ${p.EVIDENCE_PHOTO_GRACE_DAYS}일 안에 사진·명단 수집` : "행사 7일 후까지 증빙 정리·결산 반영";
      const f = fixed[d.key];
      const date = f ?? due;
      const ok = done.has(d.key) || date >= today;
      tasks.push({ key: d.key, due: f ? f : ok ? date : null, latest: date, earliestStart: today, duration: 0, feasible: ok, fixed: Boolean(f), reason: f ? "사용자 확정" : `${why} → ${md(due)}` });
    }
  }

  const milestones: Milestone[] = [];
  if (submit) {
    const ok = isFeasible("SCHOOL_SUBMIT");
    milestones.push({
      key: "SCHOOL_SUBMIT",
      title: "행정실 송부 마감(D-21)",
      date: submit >= today ? submit : null,
      latest: submit,
      feasible: ok,
      reason: ok ? `${anchors.get("SCHOOL_SUBMIT")!.reason} → ${md(submit)}` : `${anchors.get("SCHOOL_SUBMIT")!.reason} → ${md(submit)} — 일정 불가`,
    });
  }

  const feasible = tasks.every((t) => t.feasible) && milestones.every((m) => m.feasible);
  return { tasks, milestones, feasible, alternatives: feasible || !withAlternatives ? null : alternativesFor(input) };
}

/** 5-3 ⑦: 불가 시 대안 (확정값·완료 상태는 고려하지 않은 규칙 기준선으로 계산) */
export function alternativesFor(input: ScheduleInput): Alternatives {
  const base: ScheduleInput = { ...input, fixed: {}, compress: false };
  const ok = (i: ScheduleInput) => computeSchedule(i, false).feasible;
  let earliest: string | null = null;
  for (let n = 1; n <= 365; n++) {
    const s = addDays(input.eventStart, n);
    const e = input.eventEnd && input.eventEnd > input.eventStart ? addDays(input.eventEnd, n) : null;
    if (ok({ ...base, eventStart: s, eventEnd: e })) {
      earliest = s;
      break;
    }
  }
  return {
    compress: ok({ ...base, compress: true }),
    toStudentFee: input.funding.includes("school") ? ok({ ...base, funding: [...new Set([...input.funding.filter((f) => f !== "school"), "student_fee" as const])] }) : null,
    earliestEventDate: earliest,
    withoutVendor: input.usesVendor ? ok({ ...base, usesVendor: false }) : null,
  };
}

/** 확정 마감이 규칙상 최종 마감보다 늦으면 충돌 (5-3 ⑨, T16) */
export function deadlineConflicts(confirmed: Partial<Record<TemplateKey, string>>, input: Omit<ScheduleInput, "fixed">) {
  const baseline = computeSchedule({ ...input, fixed: {} }, false);
  const out: { key: TemplateKey; confirmed: string; latest: string }[] = [];
  for (const t of baseline.tasks) {
    const c = confirmed[t.key];
    if (c && c > t.latest) out.push({ key: t.key, confirmed: c, latest: t.latest });
  }
  return out;
}

export const daysBetween = (a: string, b: string) => toDays(b) - toDays(a);
