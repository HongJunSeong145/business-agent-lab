/**
 * 디자인 토큰 단일 원천 (지시서 PART 9, ADR-015).
 * app/globals.css 의 CSS 변수와 tests/unit/design-tokens.test.ts 가 이 값을 기준으로 검증한다.
 * 국서 base 색은 변경 금지(재정국만 설정에서 변경 가능 — Q1).
 */

export const DEPARTMENT_CODES = ["planning", "finance", "secretariat", "promotion", "operations"] as const;
export type DepartmentCode = (typeof DEPARTMENT_CODES)[number];

export type DeptTokens = {
  nameKo: string;
  order: number;
  base: string;
  /** 진척 채움 */
  fill: string;
  /** 채움 테두리(밝은 색 경계 보강) */
  fillBorder?: string;
  /** 남은 부분 */
  track: string;
  chipBg: string;
  /** 칩·밝은 배경 위 글자 */
  ink: string;
  /** 진한 채움 위 글자 */
  onFill: string;
};

export const DEPARTMENTS: Record<DepartmentCode, DeptTokens> = {
  planning: {
    nameKo: "기획국", order: 1, base: "#F4E1D4", fill: "#F4E1D4", fillBorder: "#D9BBA6",
    track: "#FBF3EE", chipBg: "#F4E1D4", ink: "#5A3A28", onFill: "#5A3A28",
  },
  finance: {
    nameKo: "재정국", order: 2, base: "#8EC5E4", fill: "#8EC5E4",
    track: "#E3F1F9", chipBg: "#DCEEF8", ink: "#0F3D57", onFill: "#0F3D57",
  },
  secretariat: {
    nameKo: "사무국", order: 3, base: "#7F0810", fill: "#7F0810",
    track: "#F0D4D6", chipBg: "#F3DDDF", ink: "#7F0810", onFill: "#FFFFFF",
  },
  promotion: {
    nameKo: "홍보국", order: 4, base: "#E19E86", fill: "#E19E86",
    track: "#F8E6DF", chipBg: "#F8E6DF", ink: "#6B2E1A", onFill: "#6B2E1A",
  },
  operations: {
    nameKo: "집행국", order: 5, base: "#276C91", fill: "#276C91",
    track: "#D6E6EF", chipBg: "#DDEBF3", ink: "#1D5270", onFill: "#FFFFFF",
  },
};

export const NEUTRAL = {
  bg: "#FAFAF8",
  surface: "#FFFFFF",
  border: "#E7E5E1",
  text: "#1F2328",
  textMuted: "#5F6670",
} as const;

export const STATUS = {
  success: "#2E7D4F",
  /** 경고 아이콘·테두리 전용 (흰 배경 글자 대비 3.64 — 글자에는 warningText 사용) */
  warning: "#B7791F",
  warningText: "#8A5A12",
  danger: "#B42318",
  info: "#3B5B7A",
} as const;

export function deptOrdered(): { code: DepartmentCode; tokens: DeptTokens }[] {
  return DEPARTMENT_CODES.map((code) => ({ code, tokens: DEPARTMENTS[code] })).sort(
    (a, b) => a.tokens.order - b.tokens.order,
  );
}

// ── WCAG 2.x 대비 계산 ──
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
