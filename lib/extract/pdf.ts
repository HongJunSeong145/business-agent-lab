import { getDocumentProxy } from "unpdf";
import { ExtractionError, REUPLOAD_HINT } from "./errors";
import { meaningfulLength } from "./normalize";

/**
 * PDF 텍스트 레이어 추출 (D14).
 *  - 글자 위치로 줄을 다시 만든다(줄 단위 y 그룹 → x 정렬).
 *  - 가로 방향 쪽에서 가운데를 가로지르는 글자가 없으면 "한 장에 두 쪽"(2-up, 소책자 인쇄) 형식으로 보고
 *    왼쪽 쪽 → 오른쪽 쪽 순서로 읽는다. (실제 학생회 회의록 샘플이 이 형식)
 *  - 텍스트 레이어가 없으면(스캔 PDF) 실패 + 안내. OCR 은 v1 범위 밖.
 */
const SINGLE_HANGUL = /^\s*[\uAC00-\uD7A3]\s*$/;
const ENDS_WITH_SINGLE_HANGUL = /(?:^|\s)[\uAC00-\uD7A3]\s*$/;

type Item = { str: string; x: number; y: number; w: number; h: number };

export type PdfExtractResult = { text: string; pages: number; twoUpPages: number };

function toLines(items: Item[]): string[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; h: number; items: Item[] }[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    const tol = Math.max(2, Math.min(it.h, last?.h ?? it.h) * 0.5);
    if (last && Math.abs(last.y - it.y) <= tol) last.items.push(it);
    else lines.push({ y: it.y, h: it.h, items: [it] });
  }
  const heights = lines.map((l) => l.h).filter((h) => h > 0).sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)] ?? 10;
  const out: string[] = [];
  let prevY: number | null = null;
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    let s = "";
    let prevEnd: number | null = null;
    let prevStr = "";
    for (const it of l.items) {
      if (!it.str.trim()) continue; // 공백 글자 항목은 위치 간격으로 대신 판단
      const gap = prevEnd === null ? 0 : it.x - prevEnd;
      // 자간을 넓힌 이름(예: "홍   준   성")은 한 글자씩 따로 놓이므로 붙여 쓴다
      const letterSpaced = ENDS_WITH_SINGLE_HANGUL.test(prevStr) && SINGLE_HANGUL.test(it.str) && gap > it.h * 0.6 && gap < it.h * 2.5;
      if (prevEnd !== null && !letterSpaced && gap > Math.max(1, it.h * 0.15) && !s.endsWith(" ") && !it.str.startsWith(" ")) s += " ";
      s += letterSpaced ? it.str.trim() : it.str;
      prevEnd = it.x + it.w;
      prevStr = it.str;
    }
    if (prevY !== null && prevY - l.y > typical * 2.2) out.push("");
    out.push(s.replace(/\s{2,}/g, " ").trim());
    prevY = l.y;
  }
  return out;
}

export async function extractPdf(bytes: Uint8Array): Promise<PdfExtractResult> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    if (name === "PasswordException") throw new ExtractionError(`암호가 걸린 PDF는 읽을 수 없습니다. 암호를 해제하거나 ${REUPLOAD_HINT}`, "pdf_encrypted");
    throw new ExtractionError(`PDF 파일을 열 수 없습니다(손상되었을 수 있음). ${REUPLOAD_HINT}`, "pdf_corrupt");
  }

  const pageTexts: string[] = [];
  let twoUp = 0;
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const raw of content.items) {
        if (!("str" in raw) || !raw.str) continue;
        const t = raw.transform as number[];
        items.push({ str: raw.str, x: t[4]!, y: t[5]!, w: raw.width, h: raw.height || Math.abs(t[3]!) });
      }
      const mid = vp.width / 2;
      const landscape = vp.width > vp.height;
      const crossing = items.filter((i) => i.str.trim() && i.x < mid - 3 && i.x + i.w > mid + 3).length;
      const left = items.filter((i) => i.x + i.w / 2 < mid);
      const right = items.filter((i) => i.x + i.w / 2 >= mid);
      if (landscape && crossing === 0 && left.length > 0 && right.length > 0) {
        twoUp++;
        pageTexts.push([...toLines(left), "", ...toLines(right)].join("\n"));
      } else {
        pageTexts.push(toLines(items).join("\n"));
      }
    }
  } finally {
    await pdf.cleanup?.();
  }

  const text = pageTexts.join("\n\n");
  if (meaningfulLength(text) < 20) {
    throw new ExtractionError(
      "이 PDF에는 글자 정보(텍스트 레이어)가 없습니다. 스캔·사진으로 만든 PDF로 보입니다. 원본 문서(HWP·한글, Word)에서 'PDF로 저장' 또는 HWPX로 저장해 다시 올려 주세요.",
      "pdf_scanned",
    );
  }
  const unreadable = (text.match(/[-�]/g) ?? []).length;
  if (unreadable / Math.max(1, meaningfulLength(text)) > 0.3) {
    throw new ExtractionError(`PDF의 글꼴 정보가 없어 글자를 읽을 수 없습니다. ${REUPLOAD_HINT}`, "pdf_unmapped_font");
  }
  return { text, pages: pdf.numPages, twoUpPages: twoUp };
}
