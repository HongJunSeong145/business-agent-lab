/**
 * 감사 로그 개인정보 마스킹 (지시서 0-5 ⑪, 10-3, ADR-018).
 * 키 이름 기준 마스킹 + 값 패턴(전화·이메일·학번) 마스킹을 함께 적용한다.
 */
const SENSITIVE_KEYS = new Set([
  "phone", "gmail", "school_email", "student_id", "email", "password", "password_hash", "token", "token_hash",
]);

const PATTERNS: RegExp[] = [
  /[\w.+-]+@[\w-]+(\.[\w-]+)+/g, // 이메일
  /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, // 휴대전화
  /\b20\d{8}\b/g, // 학번(10자리, 20xx로 시작)
];

export function maskText(value: string): string {
  return PATTERNS.reduce((acc, re) => acc.replace(re, "***"), value);
}

export function maskDeep(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEYS.has(key)) return value === null || value === undefined ? value : "***";
  if (typeof value === "string") return maskText(value);
  if (Array.isArray(value)) return value.map((v) => maskDeep(v));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, maskDeep(v, k)]));
  }
  return value;
}
