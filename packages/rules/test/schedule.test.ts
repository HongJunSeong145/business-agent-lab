import { describe, expect, it } from "vitest";
import { alternativesFor, computeSchedule, daysBetween, deadlineConflicts, type ScheduleInput } from "../src/schedule";
import { DEFAULT_PARAMS, minDuration, type RuleParams } from "../src/params";
import { templateFor } from "../src/templates";

const base = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  eventStart: "2026-12-10", today: "2026-10-31", funding: ["school"], usesVendor: true, params: DEFAULT_PARAMS, ...over,
});
const byKey = (r: ReturnType<typeof computeSchedule>) => Object.fromEntries(r.tasks.map((t) => [t.key, t]));

describe("T5 마감 역산: 교비 + 외부업체, 행사일 2026-12-10, 오늘 2026-10-31", () => {
  const r = computeSchedule(base());
  const t = byKey(r);
  it("행정실 송부 = 2026-11-19", () => {
    expect(r.milestones[0]).toMatchObject({ key: "SCHOOL_SUBMIT", date: "2026-11-19", feasible: true });
    expect(r.milestones[0]!.reason).toBe("교비 사업: 행사일(12/10) 21일 전 행정실 송부 → 11/19");
  });
  it("업체 확정 ≤ 2026-11-12", () => {
    expect(t.VENDOR_CONFIRM!.due).toBe("2026-11-12");
    expect(t.VENDOR_CONFIRM!.reason).toContain("행정실 송부(11/19) 7일 전");
  });
  it("기획안 결재가 업체 컨택(업체 확정 착수)보다 앞섬", () => {
    const vendorStart = "2026-11-12";
    expect(t.PLN_APPROVAL!.due! <= vendorStart).toBe(true);
    expect(t.PLN_APPROVAL!.due).toBe("2026-11-05");
  });
  it("고정 앵커: 홍보 게시·집행 매뉴얼 D-7, 최종 구입 D-3, 행사 후 업무", () => {
    expect(t.PRO_PUBLISH!.due).toBe("2026-12-03");
    expect(t.OPS_MANUAL!.due).toBe("2026-12-03");
    expect(t.FIN_PURCHASE!.due).toBe("2026-12-07");
    expect(t.OPS_EXECUTE!.due).toBe("2026-12-10");
    expect(t.OPS_EVIDENCE!.due).toBe("2026-12-11");
  });
  it("40일 남은 교비+외부업체 행사는 상류 업무가 불가 → 자동 압축 없이 대안 제시 (ADR-014)", () => {
    expect(r.feasible).toBe(false);
    expect(t.PLN_DRAFT!.feasible).toBe(false);
    expect(t.PLN_DRAFT!.due).toBe("2026-11-02"); // 날짜는 그대로, 불가 표시
    expect(t.FIN_BUDGET_RANGE!.due).toBeNull(); // 최종 마감(10/30)이 이미 지남 → 과거 날짜 미생성
    expect(t.FIN_BUDGET_RANGE!.latest).toBe("2026-10-30");
    expect(t.FIN_BUDGET_RANGE!.reason).toContain("일정 불가");
    expect(r.alternatives).toEqual({ compress: true, toStudentFee: true, earliestEventDate: "2026-12-14", withoutVendor: true });
  });
  it("같은 입력이면 같은 결과 (D16)", () => {
    expect(computeSchedule(base())).toEqual(r);
  });
});

describe("T6 마감 불가: 행사일 2026-11-10, 교비", () => {
  const r = computeSchedule(base({ eventStart: "2026-11-10", usesVendor: false }));
  it("infeasible + 과거 날짜를 만들지 않음", () => {
    expect(r.feasible).toBe(false);
    expect(r.milestones[0]).toMatchObject({ date: null, latest: "2026-10-20", feasible: false });
    for (const t of r.tasks) if (t.due) expect(t.due >= "2026-10-31").toBe(true);
  });
  it("대안: 학생회비 전환 가능 여부, 연기 시 최단일", () => {
    expect(r.alternatives).toMatchObject({ toStudentFee: false, withoutVendor: null, earliestEventDate: "2026-12-01" });
    const later = computeSchedule(base({ eventStart: r.alternatives!.earliestEventDate!, usesVendor: false }));
    expect(later.feasible).toBe(true);
  });
});

describe("T7 주말·휴일 보정", () => {
  it("추천 마감이 토요일이면 직전 금요일, 근거에 표시", () => {
    // 행사 2026-12-12(토) → 홍보 게시 D-7 = 12/05(토) → 12/04(금)
    const r = computeSchedule(base({ eventStart: "2026-12-12", funding: ["student_fee"], usesVendor: false }));
    const t = byKey(r);
    expect(t.PRO_PUBLISH!.due).toBe("2026-12-04");
    expect(t.PRO_PUBLISH!.reason).toContain("토·일·휴일이라 직전 평일로 당김");
    expect(t.OPS_EXECUTE!.due).toBe("2026-12-12"); // 행사일 자체는 그대로
  });
  it("설정의 휴일도 피한다", () => {
    const params: RuleParams = { ...DEFAULT_PARAMS, HOLIDAYS: ["2026-12-03", "2026-12-02"] };
    const t = byKey(computeSchedule(base({ params, funding: ["student_fee"], usesVendor: false })));
    expect(t.PRO_PUBLISH!.due).toBe("2026-12-01");
  });
  it("교비 송부일이 주말이면 금요일로", () => {
    // 행사 2026-12-12(토) → D-21 = 11/21(토) → 11/20(금)
    const r = computeSchedule(base({ eventStart: "2026-12-12", usesVendor: false }));
    expect(r.milestones[0]!.date).toBe("2026-11-20");
  });
});

describe("확정 마감·완료·압축·홍보 등급·기간 행사", () => {
  it("확정 마감은 그대로 두고 제약으로만 사용 (5-3 ⑨)", () => {
    const r = computeSchedule(base({ funding: ["student_fee"], usesVendor: false, fixed: { PLN_APPROVAL: "2026-11-30", OPS_EVIDENCE: "2026-12-15" } }));
    const t = byKey(r);
    expect(t.PLN_APPROVAL).toMatchObject({ due: "2026-11-30", fixed: true, reason: "사용자 확정" });
    expect(t.PLN_DRAFT!.due).toBe("2026-11-27"); // 확정 결재일(11/30) - 3일
    expect(t.OPS_EVIDENCE).toMatchObject({ due: "2026-12-15", fixed: true });
  });
  it("완료된 업무는 후속 시작을 막지 않음", () => {
    const r = computeSchedule(base({ done: ["FIN_BUDGET_RANGE", "PLN_DRAFT", "PLN_APPROVAL", "OPS_EVIDENCE"] }));
    const t = byKey(r);
    expect(t.PLN_DRAFT!.feasible).toBe(true);
    expect(t.VENDOR_CONFIRM!.earliestStart).toBe("2026-10-31");
    expect(t.OPS_EVIDENCE!.feasible).toBe(true);
  });
  it("압축(최소 소요일)", () => {
    const t = byKey(computeSchedule(base({ compress: true })));
    expect(t.PLN_DRAFT!.duration).toBe(minDuration(5));
    expect(minDuration(1)).toBe(1);
  });
  it("홍보 등급별 제작 소요: 미정=저비용 4일(N5), 고비용 17일", () => {
    expect(byKey(computeSchedule(base())).PRO_MAKE!.duration).toBe(4);
    expect(byKey(computeSchedule(base({ promoTier: "high" }))).PRO_MAKE!.duration).toBe(17);
    expect(byKey(computeSchedule(base({ promoTier: "free" }))).PRO_MAKE!.duration).toBe(3);
  });
  it("여러 날 행사: 집행·증빙은 종료일 기준", () => {
    const t = byKey(computeSchedule(base({ funding: ["student_fee"], eventEnd: "2026-12-11" })));
    expect(t.OPS_EXECUTE!.due).toBe("2026-12-11");
    expect(t.FIN_EVIDENCE!.due).toBe("2026-12-18");
    expect(t.OPS_EVIDENCE!.due).toBe("2026-12-12");
  });
  it("이미 지난 행사의 사후 업무는 불가 표시, 날짜 미생성", () => {
    const t = byKey(computeSchedule(base({ eventStart: "2026-10-01", funding: ["student_fee"], usesVendor: false }), false));
    expect(t.FIN_EVIDENCE).toMatchObject({ due: null, feasible: false });
  });
  it("학생회비 + 외부업체: 최종 구입 전에 업체 확정 (송부 앵커 없음)", () => {
    const defs = templateFor({ funding: ["student_fee"], usesVendor: true });
    expect(defs.find((d) => d.key === "FIN_PURCHASE")!.deps.map((d) => d.key)).toContain("VENDOR_CONFIRM");
    const r = computeSchedule(base({ funding: ["student_fee"] }));
    expect(r.milestones).toEqual([]);
    expect(byKey(r).VENDOR_CONFIRM!.due).toBe("2026-12-04"); // 최종 구입(12/7) 소요 1일 전 → 12/6(일) → 12/4(금)
  });
  it("재원 미정: 증빙 업무 없음", () => {
    const keys = templateFor({ funding: [], usesVendor: false }).map((d) => d.key);
    expect(keys).not.toContain("OPS_EVIDENCE");
    expect(keys).not.toContain("FIN_EVIDENCE");
  });
});

describe("대안 계산 경계", () => {
  it("1년 안에 가능한 날짜가 없으면 null", () => {
    const params: RuleParams = { ...DEFAULT_PARAMS, DEFAULT_DURATIONS: { ...DEFAULT_PARAMS.DEFAULT_DURATIONS, SEC_CONTACT: 1000 } };
    const a = alternativesFor(base({ params, funding: ["student_fee"], usesVendor: false, eventEnd: "2026-12-11" }));
    expect(a.earliestEventDate).toBeNull();
    expect(a.toStudentFee).toBeNull();
  });
});

describe("T16 보조: 확정 마감 충돌 탐지", () => {
  it("확정 마감이 규칙상 최종 마감보다 늦으면 충돌", () => {
    const input = base({ funding: ["student_fee"], usesVendor: false, eventStart: "2026-12-01" });
    const c = deadlineConflicts({ PRO_PUBLISH: "2026-11-27", OPS_MANUAL: "2026-11-20" }, input);
    expect(c).toEqual([{ key: "PRO_PUBLISH", confirmed: "2026-11-27", latest: "2026-11-24" }]);
  });
  it("daysBetween", () => expect(daysBetween("2026-10-31", "2026-12-10")).toBe(40));
});
