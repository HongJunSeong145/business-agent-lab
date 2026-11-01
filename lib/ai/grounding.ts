/**
 * 원문 근거 검증 (T2): AI 가 준 문단 번호·인용을 실제 회의록 원문과 대조한다.
 *  - 인용이 그 문단에 있으면 그대로, 다른 문단에 있으면 문단 번호를 바로잡고, 어디에도 없으면 grounded=false.
 */
export type Paragraph = { n: number; text: string };

const norm = (s: string) => s.replace(/\s+/g, "").replace(/[“”"'‘’]/g, "");

export function groundRef(paras: Paragraph[], para: number, quote: string): { para: number; quote: string; grounded: boolean } {
  const q = norm(quote);
  if (!q) return { para, quote, grounded: paras.some((p) => p.n === para) };
  const at = paras.find((p) => p.n === para);
  if (at && norm(at.text).includes(q)) return { para, quote, grounded: true };
  const found = paras.find((p) => norm(p.text).includes(q));
  if (found) return { para: found.n, quote, grounded: true };
  return { para, quote, grounded: false };
}

/** 객체 트리 안의 {para, quote} 를 모두 검증해 grounded 를 붙인다 */
export function groundAll<T>(value: T, paras: Paragraph[]): T {
  if (Array.isArray(value)) return value.map((v) => groundAll(v, paras)) as T;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = groundAll(v, paras);
    if (typeof o.para === "number" && typeof o.quote === "string") Object.assign(out, groundRef(paras, o.para, o.quote));
    return out as T;
  }
  return value;
}

/** LLM 에 보낼 번호 붙은 원문 */
export function numbered(paras: Paragraph[]): string {
  return paras.map((p) => `[${p.n}] ${p.text}`).join("\n");
}
