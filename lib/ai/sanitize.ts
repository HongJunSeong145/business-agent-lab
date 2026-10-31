/**
 * AI 예시안의 HTML/SVG 정리 — 화면에서는 스크립트가 꺼진 sandbox iframe / <img> 로만 보여 주지만,
 * 내려받은 파일을 브라우저로 열 때를 대비해 실행 가능한 요소를 미리 지운다.
 */
export function sanitizeMarkup(src: string): string {
  return src
    .replace(/<\s*(script|iframe|object|embed|foreignObject|link|meta|base|form)\b[\s\S]*?(<\s*\/\s*\1\s*>|\/>|$)/gi, "")
    .replace(/<\s*(script|iframe|object|embed|foreignObject|link|meta|base|form)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|xlink:href)\s*=\s*("|')\s*(javascript|data|vbscript):[^"']*\2/gi, '$1="#"')
    .replace(/url\(\s*['"]?\s*(https?:|javascript:|data:)[^)]*\)/gi, "none")
    .replace(/@import[^;]*;?/gi, "");
}
