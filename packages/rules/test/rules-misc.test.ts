import { describe, expect, it } from "vitest";
import { addDays, fromDays, isOffDay, md, prevWorkday, toDays, weekday } from "../src/dates";
import { evidenceRequirements, rosterRequired, schoolTax, withTax } from "../src/funding";
import { promoTier, PROMO_TIER_LABEL } from "../src/promo";
import { quartersFromAcademicCalendar } from "../src/term";
import { DEFAULT_PARAMS } from "../src/params";

describe("날짜", () => {
  it("변환·더하기·요일·표시", () => {
    expect(fromDays(toDays("2026-12-10"))).toBe("2026-12-10");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekday("2026-10-31")).toBe(6);
    expect(md("2026-03-05")).toBe("3/5");
  });
  it("평일 보정", () => {
    const h = new Set(["2026-10-09"]);
    expect(isOffDay("2026-10-09", h)).toBe(true);
    expect(prevWorkday("2026-10-11", h)).toBe("2026-10-08"); // 일 → 토 → 금(한글날) → 목
    expect(prevWorkday("2026-10-08", h)).toBe("2026-10-08");
  });
});

describe("T9 세금", () => {
  it("교비 1,000,000원 → 세금 100,000원, 총액 1,100,000원", () => {
    expect(withTax(1_000_000, 0.1)).toEqual({ amount: 1_000_000, tax: 100_000, total: 1_100_000 });
    expect(schoolTax(12_345, 0.1)).toBe(1_235); // 원 단위 반올림
  });
});

describe("T8 명단 규칙 (D15)", () => {
  it("학생회비, 수혜 80·100명: 필수 / 150명: 필수 아님 / 미정: 필수", () => {
    const roster = (n: number | null) => evidenceRequirements(["student_fee"], n, DEFAULT_PARAMS).find((r) => r.type === "beneficiary_roster")!;
    expect(roster(80).required).toBe(true);
    expect(roster(100)).toMatchObject({ required: true, rule_source: "FEE_ROSTER_LE_100" });
    expect(roster(150)).toMatchObject({ required: false, rule_source: "FEE_ROSTER_GT_100" });
    expect(rosterRequired(null, 100)).toBe(true);
  });
  it("재원별 증빙 요구", () => {
    const types = (f: ("school" | "student_fee")[]) => evidenceRequirements(f, 150, DEFAULT_PARAMS).map((r) => `${r.type}:${r.required}`);
    expect(types(["school"])).toEqual(["official_letter:true", "plan_doc:true", "photo:false"]);
    expect(types(["student_fee"])).toEqual(["receipt:true", "photo:true", "beneficiary_roster:false"]);
    expect(types(["school", "student_fee"])).toEqual(["official_letter:true", "plan_doc:true", "receipt:true", "photo:true", "beneficiary_roster:false"]);
    expect(types([])).toEqual([]);
  });
});

describe("홍보 등급 (5-4)", () => {
  it("비용·수량 기준", () => {
    expect(promoTier({ cost: 0, qty: 0 }, DEFAULT_PARAMS)).toBe("free");
    expect(promoTier({ cost: 50_000, qty: 10 }, DEFAULT_PARAMS)).toBe("low");
    expect(promoTier({ cost: 300_000, qty: 1 }, DEFAULT_PARAMS)).toBe("high");
    expect(promoTier({ cost: 0, qty: 300 }, DEFAULT_PARAMS)).toBe("high"); // 유형 무관, 수량 많으면 고비용
    expect(PROMO_TIER_LABEL.low).toBe("저비용");
  });
});

describe("학사일정 → 분기 (D5)", () => {
  const cal = { electionEnd: "2025-11-27", sem1Start: "2026-03-02", sem1End: "2026-06-19", sem2Start: "2026-09-01", nextElectionEnd: "2026-11-26" };
  it("자동 계산", () => {
    expect(quartersFromAcademicCalendar(cal)).toEqual({
      q1_start: "2025-11-27", q1_end: "2026-03-01", q2_start: "2026-03-02", q2_end: "2026-06-19",
      q3_start: "2026-06-20", q3_end: "2026-08-31", q4_start: "2026-09-01", q4_end: "2026-11-26",
    });
  });
  it("순서 오류·여름방학 없음 거부", () => {
    expect(() => quartersFromAcademicCalendar({ ...cal, sem1Start: "2025-11-01" })).toThrow(/순서/);
    expect(() => quartersFromAcademicCalendar({ ...cal, sem2Start: "2026-06-20" })).toThrow(/여름방학/);
  });
});
