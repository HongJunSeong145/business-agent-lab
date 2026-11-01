import { describe, expect, it } from "vitest";
import { projectProgress, type ProgressTask } from "../src/progress";

const ORDER = ["planning", "finance", "secretariat", "promotion", "operations"];
const t = (leadCode: string, effective: number, weight = 1, status = "todo"): ProgressTask => ({ leadCode, effective, weight, status });

describe("projectProgress (D4, T18 계산식)", () => {
  it("업무 없으면 0%, 모든 구간 0", () => {
    const r = projectProgress([], ORDER);
    expect(r.total).toBe(0);
    expect(r.segments.map((s) => s.share)).toEqual([0, 0, 0, 0, 0]);
  });
  it("구간 폭 = 주관 업무 가중치 비율, 채움 = 국서 진척, 합계 = 가중 합", () => {
    const r = projectProgress([t("planning", 100, 2), t("planning", 50, 2), t("promotion", 0, 1), t("operations", 60, 3)], ORDER);
    const seg = Object.fromEntries(r.segments.map((s) => [s.code, s]));
    expect(seg.planning).toMatchObject({ share: 0.5, progress: 75, taskCount: 2 });
    expect(seg.promotion).toMatchObject({ share: 0.125, progress: 0 });
    expect(seg.operations!.share).toBeCloseTo(0.375);
    expect(seg.operations!.progress).toBe(60);
    expect(r.total).toBeCloseTo(0.5 * 75 + 0.375 * 60);
    expect(r.segments.map((s) => s.code)).toEqual(ORDER); // 기획→재정→사무→홍보→집행
  });
  it("취소·가중치 0 업무 제외", () => {
    const r = projectProgress([t("finance", 100), t("finance", 0, 1, "cancelled"), t("finance", 0, 0)], ORDER);
    expect(r.total).toBe(100);
  });
  it("회장 덮어쓰기: 업무 있는 국서끼리 정규화, 업무 없는 국서·0 이하 값 무시", () => {
    const r = projectProgress([t("planning", 100), t("finance", 0)], ORDER, { planning: 3, finance: 1, promotion: 5, operations: 0 });
    expect(r.segments[0]!.share).toBeCloseTo(0.75);
    expect(r.segments[1]!.share).toBeCloseTo(0.25);
    expect(r.total).toBeCloseTo(75);
    expect(r.overrideIgnored).toEqual(["promotion"]);
  });
  it("덮어쓰기 값이 모두 무효면 기본 가중치", () => {
    const r = projectProgress([t("planning", 100), t("finance", 0)], ORDER, { promotion: 2 });
    expect(r.total).toBeCloseTo(50);
  });
});
