import { describe, expect, it } from "vitest";
import { detectAlerts, severityByDaysLeft, summarizeAlerts, type MonitorProject, type MonitorTask } from "../src";

const T = (o: Partial<MonitorTask> = {}): MonitorTask => ({
  id: "t", title: "업무", project_id: "p", status: "todo", is_completed: false, due: null, due_feasible: true, template_key: null, last_change: "2026-10-31", blocked_since: null, ...o,
});
const P = (o: Partial<MonitorProject> = {}): MonitorProject => ({
  id: "p", title: "사업", status: "planning", event_end: null, student_fee: true, roster_required: false, evidence: [], purchased: [], ...o,
});
const run = (tasks: MonitorTask[], projects: MonitorProject[] = [P()], extra = {}) =>
  detectAlerts({ today: "2026-10-31", tasks, projects, stallDays: 3, photoGraceDays: 1, ...extra });

describe("A7 모니터링 규칙", () => {
  it("등급 상승: D-7 info → D-3 warn → D-1·당일 critical, 그보다 멀면 없음", () => {
    expect([8, 7, 4, 3, 2, 1, 0].map(severityByDaysLeft)).toEqual([null, "info", "info", "warn", "warn", "critical", "critical"]);
  });
  it("마감 임박·초과·행정실 송부·불가 일정", () => {
    const a = run([
      T({ id: "a", due: "2026-11-03" }), T({ id: "b", due: "2026-10-29" }), T({ id: "c", due: "2026-12-31" }),
      T({ id: "d", due: "2026-10-31", template_key: "PRES_SUBMIT_SCHOOL" }), T({ id: "s", due: "2026-11-30", template_key: "PRES_SUBMIT_SCHOOL" }),
      T({ id: "e", due_feasible: false }), T({ id: "f", due: "2026-10-31" }),
    ]);
    expect(a.map((x) => [x.entity, x.kind, x.severity])).toEqual([
      ["a", "deadline", "warn"], ["b", "overdue", "critical"], ["d", "school_submit", "critical"], ["e", "infeasible", "warn"], ["f", "deadline", "critical"],
    ]);
    expect(a.find((x) => x.entity === "f")!.title).toContain("오늘");
    expect(a.find((x) => x.entity === "d")!.audience).toBe("president_planning");
  });
  it("완료·취소 업무, 취소된 사업의 업무는 제외 / 사업 외 업무는 포함", () => {
    expect(run([T({ is_completed: true, due: "2026-10-30" }), T({ status: "cancelled", due: "2026-10-30" }), T({ status: "done", due: "2026-10-30" })])).toEqual([]);
    expect(run([T({ due: "2026-10-30" })], [P({ status: "cancelled" })])).toEqual([]);
    expect(run([T({ project_id: null, due: "2026-10-30" })], [])).toHaveLength(1);
  });
  it("진척 없음(STALL_DAYS)·차단 장기화", () => {
    const a = run([
      T({ id: "s1", status: "in_progress", last_change: "2026-10-28" }), T({ id: "s2", status: "in_progress", last_change: "2026-10-29" }),
      T({ id: "b1", status: "blocked", blocked_since: "2026-10-20" }), T({ id: "b2", status: "blocked", blocked_since: "2026-10-28" }), T({ id: "b3", status: "blocked" }),
    ]);
    expect(a.map((x) => `${x.entity}:${x.kind}`)).toEqual(["s1:stall", "b1:blocked_long"]);
    expect(run([T({ status: "blocked", blocked_since: "2026-10-28" })], [P()], { blockedDays: 2 })[0]!.kind).toBe("blocked_long");
  });
  it("T20 증빙: 영수증 없는 구입(시간이 갈수록 등급 상승)·행사 후 사진·명단, 학생회비 사업만", () => {
    const purchased = [
      { id: "i1", name: "과자", purchased_on: "2026-10-30", has_receipt: false },
      { id: "i2", name: "음료", purchased_on: "2026-10-23", has_receipt: false },
      { id: "i3", name: "컵", purchased_on: "2026-10-01", has_receipt: false },
      { id: "i4", name: "봉투", purchased_on: "2026-10-01", has_receipt: true },
    ];
    const a = run([], [P({ purchased, event_end: "2026-10-29", roster_required: true })]);
    expect(a.map((x) => [x.entity, x.kind, x.severity])).toEqual([
      ["i1", "receipt_missing", "info"], ["i2", "receipt_missing", "warn"], ["i3", "receipt_missing", "critical"],
      ["p:photo", "photo_missing", "warn"], ["p:roster", "roster_missing", "warn"],
    ]);
    expect(a.every((x) => x.audience === "finance")).toBe(true);
    const later = run([], [P({ event_end: "2026-10-20", roster_required: true })]);
    expect(later.map((x) => x.severity)).toEqual(["critical", "critical"]);
    expect(run([], [P({ event_end: "2026-10-29", roster_required: true, evidence: [{ type: "photo", count: 1 }, { type: "beneficiary_roster", count: 2 }] })])).toEqual([]);
    expect(run([], [P({ event_end: "2026-10-30" })])).toEqual([]); // 유예 기간 안
    expect(run([], [P({ student_fee: false, purchased, event_end: "2026-10-01" })])).toEqual([]);
    expect(run([], [P({ status: "cancelled", purchased })])).toEqual([]);
    expect(run([], [P({ purchased: [{ id: "x", name: "x", purchased_on: "2026-10-31", has_receipt: false }] })], { receiptGraceDays: 0 })[0]!.severity).toBe("info");
  });
  it("사무국 노티스 집계", () => {
    const a = run([T({ id: "a", due: "2026-11-03" }), T({ id: "b", due: "2026-10-29" }), T({ id: "e", due_feasible: false }), T({ id: "s", status: "in_progress", last_change: "2026-10-01" })], [P({ event_end: "2026-10-01" })]);
    expect(summarizeAlerts(a)).toEqual({ total: 5, critical: 2, overdue: 1, upcoming: 1, stalled: 1, evidence: 1, infeasible: 1 });
  });
});
