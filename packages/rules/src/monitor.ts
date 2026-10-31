import { addDays, toDays } from "./dates";

/** b - a (일) */
const diffDays = (a: string, b: string) => toDays(b) - toDays(a);

/**
 * A7 모니터링 탐지 규칙 (5-6, 6-2 A7) — 코드가 판단한다(D16). 같은 입력이면 같은 알림.
 *  - 마감 임박·초과: D-7 info → D-3 warn → D-1·초과 critical
 *  - 진척 없음: 진행 중인데 STALL_DAYS 동안 진척도·상태 변화 없음
 *  - 차단 장기화: 7일 넘게 차단
 *  - 불가 일정: 제안 마감이 불가(infeasible)
 *  - 증빙 누락(학생회비): 구입 완료 후 영수증·이체내역 없음 / 행사 후 사진 없음 / 명단 필요 사업에 명단 없음
 *  - 교비: 행정실 송부(D-21) 업무 미완료 → critical
 */
export type Severity = "info" | "warn" | "critical";

export function severityByDaysLeft(daysLeft: number): Severity | null {
  if (daysLeft <= 1) return "critical";
  if (daysLeft <= 3) return "warn";
  if (daysLeft <= 7) return "info";
  return null;
}

export type MonitorTask = {
  id: string;
  title: string;
  project_id: string | null;
  status: string;
  is_completed: boolean;
  due: string | null;
  due_feasible: boolean;
  template_key: string | null;
  /** 진척도·상태가 마지막으로 바뀐 날(KST) */
  last_change: string;
  /** 차단 상태가 된 날 */
  blocked_since: string | null;
};

export type MonitorProject = {
  id: string;
  title: string;
  status: string;
  event_end: string | null;
  student_fee: boolean;
  roster_required: boolean;
  evidence: { type: string; count: number }[];
  purchased: { id: string; name: string; purchased_on: string; has_receipt: boolean }[];
};

export type Alert = {
  kind: "deadline" | "overdue" | "stall" | "blocked_long" | "infeasible" | "receipt_missing" | "photo_missing" | "roster_missing" | "school_submit";
  severity: Severity;
  entity: string;
  project_id: string | null;
  task_id: string | null;
  title: string;
  /** 받는 사람: 업무 담당자 / 재정국 / 회장·기획국장 */
  audience: "assignees" | "finance" | "president_planning";
};

const ACTIVE = (t: MonitorTask) => !t.is_completed && t.status !== "cancelled" && t.status !== "done";

export function detectAlerts(input: { today: string; tasks: MonitorTask[]; projects: MonitorProject[]; stallDays: number; photoGraceDays: number; receiptGraceDays?: number; blockedDays?: number }): Alert[] {
  const { today } = input;
  const out: Alert[] = [];
  const projectOk = new Set(input.projects.filter((p) => p.status !== "cancelled").map((p) => p.id));
  for (const t of input.tasks) {
    if (!ACTIVE(t) || (t.project_id && !projectOk.has(t.project_id))) continue;
    const base = { entity: t.id, project_id: t.project_id, task_id: t.id };
    if (t.due) {
      const left = diffDays(today, t.due);
      if (t.template_key === "PRES_SUBMIT_SCHOOL" && left <= 0) {
        out.push({ ...base, kind: "school_submit", severity: "critical", title: `행정실 송부(D-21) 미완료: ${t.title}`, audience: "president_planning" });
      } else if (left < 0) {
        out.push({ ...base, kind: "overdue", severity: "critical", title: `마감 ${-left}일 지남: ${t.title}`, audience: "assignees" });
      } else {
        const sev = severityByDaysLeft(left);
        if (sev) out.push({ ...base, kind: "deadline", severity: sev, title: `마감 ${left === 0 ? "오늘" : `D-${left}`}: ${t.title}`, audience: "assignees" });
      }
    }
    if (!t.due_feasible) out.push({ ...base, kind: "infeasible", severity: "warn", title: `일정 불가 — 대안 검토 필요: ${t.title}`, audience: "assignees" });
    if (t.status === "in_progress" && diffDays(t.last_change, today) >= input.stallDays) {
      out.push({ ...base, kind: "stall", severity: "info", title: `${diffDays(t.last_change, today)}일째 진척 없음: ${t.title}`, audience: "assignees" });
    }
    const blockedDays = input.blockedDays ?? 7;
    if (t.status === "blocked" && t.blocked_since && diffDays(t.blocked_since, today) > blockedDays) {
      out.push({ ...base, kind: "blocked_long", severity: "warn", title: `${diffDays(t.blocked_since, today)}일째 차단: ${t.title}`, audience: "assignees" });
    }
  }
  for (const p of input.projects) {
    if (p.status === "cancelled" || !p.student_fee) continue;
    const base = { project_id: p.id, task_id: null };
    const has = (type: string) => (p.evidence.find((e) => e.type === type)?.count ?? 0) > 0;
    const receiptGrace = input.receiptGraceDays ?? 3;
    for (const it of p.purchased) {
      if (it.has_receipt) continue;
      const sev = severityByDaysLeft(diffDays(today, addDays(it.purchased_on, receiptGrace + 7)));
      out.push({ ...base, entity: it.id, kind: "receipt_missing", severity: sev ?? "info", title: `영수증·이체내역 없음: ${p.title} — ${it.name}`, audience: "finance" });
    }
    if (p.event_end && diffDays(p.event_end, today) > input.photoGraceDays) {
      const overdueBy = diffDays(addDays(p.event_end, input.photoGraceDays), today);
      if (!has("photo")) out.push({ ...base, entity: `${p.id}:photo`, kind: "photo_missing", severity: overdueBy >= 3 ? "critical" : "warn", title: `행사 사진 없음: ${p.title}`, audience: "finance" });
      if (p.roster_required && !has("beneficiary_roster")) out.push({ ...base, entity: `${p.id}:roster`, kind: "roster_missing", severity: overdueBy >= 3 ? "critical" : "warn", title: `수혜자 명단 없음(100명 이하 필수): ${p.title}`, audience: "finance" });
    }
  }
  return out;
}

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, warn: 1, critical: 2 };

/** 사무국 노티스용 집계 */
export function summarizeAlerts(alerts: Alert[]) {
  const by = (k: Alert["kind"][]) => alerts.filter((a) => k.includes(a.kind)).length;
  return {
    total: alerts.length,
    critical: alerts.filter((a) => a.severity === "critical").length,
    overdue: by(["overdue"]),
    upcoming: by(["deadline"]),
    stalled: by(["stall", "blocked_long"]),
    evidence: by(["receipt_missing", "photo_missing", "roster_missing"]),
    infeasible: by(["infeasible", "school_submit"]),
  };
}
