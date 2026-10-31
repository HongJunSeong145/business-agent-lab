import { describe, expect, it } from "vitest";
import { effectiveProgress, progressSource } from "../src/progress";

describe("effectiveProgress (D3)", () => {
  it("완료면 AI·수동 값과 무관하게 100", () => {
    expect(effectiveProgress({ is_completed: true, manual_progress: 40, ai_progress: 72 })).toBe(100);
  });
  it("미완료면 수동 값 우선", () => {
    expect(effectiveProgress({ is_completed: false, manual_progress: 40, ai_progress: 72 })).toBe(40);
  });
  it("수동 0 도 유효한 값(?? 사용)", () => {
    expect(effectiveProgress({ is_completed: false, manual_progress: 0, ai_progress: 72 })).toBe(0);
  });
  it("수동 없으면 AI 값", () => {
    expect(effectiveProgress({ is_completed: false, manual_progress: null, ai_progress: 72 })).toBe(72);
  });
  it("둘 다 없으면 0", () => {
    expect(effectiveProgress({ is_completed: false, manual_progress: null, ai_progress: null })).toBe(0);
  });
  it("완료 해제 시 직전 값으로 복귀(값이 보존되므로)", () => {
    const t = { is_completed: true, manual_progress: null, ai_progress: 72 };
    expect(effectiveProgress(t)).toBe(100);
    expect(effectiveProgress({ ...t, is_completed: false })).toBe(72);
  });
});

describe("progressSource", () => {
  it.each([
    [{ is_completed: true, manual_progress: 1, ai_progress: 1 }, "completed"],
    [{ is_completed: false, manual_progress: 1, ai_progress: 1 }, "manual"],
    [{ is_completed: false, manual_progress: null, ai_progress: 1 }, "ai"],
    [{ is_completed: false, manual_progress: null, ai_progress: null }, "none"],
  ] as const)("%o → %s", (input, expected) => {
    expect(progressSource(input)).toBe(expected);
  });
});
