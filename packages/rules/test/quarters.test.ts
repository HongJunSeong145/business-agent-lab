import { describe, expect, it } from "vitest";
import { defaultQuarter, quarterOf, reviewGroup, type TermQuarters } from "../src/quarters";

const term: TermQuarters = {
  q1_start: "2025-12-01", q1_end: "2026-03-01",
  q2_start: "2026-03-02", q2_end: "2026-06-21",
  q3_start: "2026-06-22", q3_end: "2026-08-31",
  q4_start: "2026-09-01", q4_end: "2026-11-30",
};

describe("quarterOf", () => {
  it.each([
    ["2025-12-01", 1], ["2026-03-01", 1], ["2026-03-02", 2], ["2026-06-21", 2],
    ["2026-06-22", 3], ["2026-08-31", 3], ["2026-09-01", 4], ["2026-10-31", 4], ["2026-11-30", 4],
  ] as const)("%s → %d분기 (경계 포함)", (d, q) => expect(quarterOf(term, d)).toBe(q));
  it("기수 밖이면 null", () => {
    expect(quarterOf(term, "2025-11-30")).toBeNull();
    expect(quarterOf(term, "2026-12-01")).toBeNull();
  });
});

describe("defaultQuarter (T10)", () => {
  it("오늘 포함 분기", () => expect(defaultQuarter(term, "2026-10-31")).toBe(4));
  it("기수 이전 → 1", () => expect(defaultQuarter(term, "2025-01-01")).toBe(1));
  it("기수 이후 → 4", () => expect(defaultQuarter(term, "2027-01-01")).toBe(4));
  it("분기 사이 빈 날 → 다음 분기", () => {
    const gap = { ...term, q1_end: "2026-02-20", q2_end: "2026-06-10", q3_end: "2026-08-20" };
    expect(defaultQuarter(gap, "2026-02-25")).toBe(2);
    expect(defaultQuarter(gap, "2026-06-15")).toBe(3);
    expect(defaultQuarter(gap, "2026-08-25")).toBe(4);
  });
});

describe("reviewGroup", () => {
  it("1·2 → A, 3·4 → B", () => {
    expect([1, 2, 3, 4].map((q) => reviewGroup(q as 1 | 2 | 3 | 4))).toEqual(["A", "A", "B", "B"]);
  });
});
