import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, DEPARTMENTS, DEPARTMENT_CODES, deptOrdered, NEUTRAL, STATUS } from "@/lib/design/tokens";

/** 지시서 9-1·9-2, ADR-015: 글자/배경 조합 WCAG AA(본문 4.5:1) 자동 검사 */
const AA = 4.5;

describe("국서 색 토큰 (9-1)", () => {
  it("지시서 지정값 그대로 (base 색 변경 금지)", () => {
    expect(Object.fromEntries(DEPARTMENT_CODES.map((c) => [c, DEPARTMENTS[c].base]))).toEqual({
      planning: "#F4E1D4", finance: "#8EC5E4", secretariat: "#7F0810", promotion: "#E19E86", operations: "#276C91",
    });
  });
  it("표시 순서: 기획 → 재정 → 사무 → 홍보 → 집행 (D13)", () => {
    expect(deptOrdered().map((d) => d.tokens.nameKo)).toEqual(["기획국", "재정국", "사무국", "홍보국", "집행국"]);
  });

  for (const code of DEPARTMENT_CODES) {
    const t = DEPARTMENTS[code];
    it(`${t.nameKo}: 칩 글자 대비 ≥ 4.5`, () => expect(contrastRatio(t.ink, t.chipBg)).toBeGreaterThanOrEqual(AA));
    it(`${t.nameKo}: 채움 위 글자 대비 ≥ 4.5`, () => expect(contrastRatio(t.onFill, t.fill)).toBeGreaterThanOrEqual(AA));
    it(`${t.nameKo}: 남은 부분(track) 위 글자 대비 ≥ 4.5`, () => expect(contrastRatio(t.ink, t.track)).toBeGreaterThanOrEqual(AA));
    it(`${t.nameKo}: 국서 이름(ink)이 표면·배경 위에서 ≥ 4.5`, () => {
      expect(contrastRatio(t.ink, NEUTRAL.surface)).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(t.ink, NEUTRAL.bg)).toBeGreaterThanOrEqual(AA);
    });
    it(`${t.nameKo}: 채움 끝 경계선(ink) 이 채움·track 과 비텍스트 대비 3:1 이상 (ADR-015 보완)`, () => {
      expect(Math.max(contrastRatio(t.ink, t.track), contrastRatio(t.ink, t.fill))).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("중립·상태 색 (9-2)", () => {
  it("본문·보조 텍스트", () => {
    expect(contrastRatio(NEUTRAL.text, NEUTRAL.bg)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(NEUTRAL.textMuted, NEUTRAL.bg)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(NEUTRAL.textMuted, NEUTRAL.surface)).toBeGreaterThanOrEqual(AA);
  });
  it("상태 글자색 (경고는 글자 전용 색 사용)", () => {
    for (const c of [STATUS.success, STATUS.warningText, STATUS.danger, STATUS.info]) {
      expect(contrastRatio(c, NEUTRAL.surface)).toBeGreaterThanOrEqual(AA);
    }
  });
  it("경고 base 색은 글자로 쓰기엔 미달(아이콘·테두리 전용) — 회귀 방지 기록", () => {
    expect(contrastRatio(STATUS.warning, NEUTRAL.surface)).toBeLessThan(AA);
    expect(contrastRatio(STATUS.warning, NEUTRAL.surface)).toBeGreaterThanOrEqual(3);
  });
  it("흰 글자 on 기본 버튼(#1F2328)", () => expect(contrastRatio("#FFFFFF", NEUTRAL.text)).toBeGreaterThanOrEqual(AA));
});

describe("globals.css 와 토큰 일치", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const v = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1]?.toUpperCase();
  for (const code of DEPARTMENT_CODES) {
    const t = DEPARTMENTS[code];
    it(`${code} CSS 변수`, () => {
      expect(v(`dept-${code}`)).toBe(t.base);
      expect(v(`dept-${code}-fill`)).toBe(t.fill);
      expect(v(`dept-${code}-track`)).toBe(t.track);
      expect(v(`dept-${code}-chip`)).toBe(t.chipBg);
      expect(v(`dept-${code}-ink`)).toBe(t.ink);
      expect(v(`dept-${code}-on-fill`)).toBe(t.onFill);
    });
  }
  it("중립·상태 CSS 변수", () => {
    expect([v("bg"), v("surface"), v("border"), v("text"), v("text-muted")]).toEqual(Object.values(NEUTRAL));
    expect([v("success"), v("warning"), v("warning-text"), v("danger"), v("info")]).toEqual(Object.values(STATUS));
  });
});
