import { unzipSync, strFromU8 } from "fflate";
import { ExtractionError, REUPLOAD_HINT } from "./errors";

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? _,
  );
}

/** PPTX 추출: 슬라이드 순서대로 "[슬라이드 n]" 머리줄 + 문단(a:p)마다 한 줄 */
export function extractPptx(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) });
  } catch {
    throw new ExtractionError(`PPTX 파일을 읽을 수 없습니다(손상되었을 수 있음). ${REUPLOAD_HINT}`, "pptx_corrupt");
  }
  const slides = Object.keys(files).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const out: string[] = [];
  slides.forEach((name, i) => {
    const xml = strFromU8(files[name]!);
    const lines = xml
      .split(/<\/a:p>/)
      .map((p) => [...p.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) => decode(m[1]!)).join(""))
      .map((l) => l.trim())
      .filter(Boolean);
    out.push(`[슬라이드 ${i + 1}]`, ...lines, "");
  });
  return out.join("\n");
}
