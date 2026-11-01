/** 추출 텍스트 공통 정리: 줄바꿈 통일, 제어문자 제거, 쪽 번호 줄 제거, 빈 줄 3개 이상 축약 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .filter((l) => !/^\s*-\s*\d{1,3}\s*-\s*$/.test(l)) // "- 3 -" 같은 쪽 번호
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 의미 있는 글자 수(공백·기호 제외) — 스캔 PDF 판정 등에 사용 */
export function meaningfulLength(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}
