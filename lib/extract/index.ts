import type { MinutesKind } from "@/lib/files/detect";
import { extractDocx } from "./docx";
import { ExtractionError } from "./errors";
import { extractHwp } from "./hwp";
import { extractHwpx } from "./hwpx";
import { normalizeText, meaningfulLength } from "./normalize";
import { extractPdf } from "./pdf";
import { decodeText } from "./text";
import { extractPptx } from "./pptx";

export { ExtractionError } from "./errors";

export type ExtractionMethod = "pdf_text" | "docx" | "hwpx" | "hwp_best_effort" | "plain" | "paste";

export const METHOD_FOR_KIND: Record<MinutesKind, ExtractionMethod> = {
  pdf: "pdf_text", docx: "docx", hwpx: "hwpx", hwp: "hwp_best_effort", txt: "plain", md: "plain",
};

/** 형식별 추출 → 공통 정리. 실패 시 ExtractionError(사용자 안내 문구). */
export async function extractMinutes(kind: MinutesKind, bytes: Uint8Array): Promise<{ text: string; method: ExtractionMethod }> {
  let raw: string;
  switch (kind) {
    case "pdf": raw = (await extractPdf(bytes)).text; break;
    case "docx": raw = await extractDocx(bytes); break;
    case "hwpx": raw = extractHwpx(bytes); break;
    case "hwp": raw = extractHwp(bytes); break;
    case "txt":
    case "md": raw = decodeText(bytes).text; break;
  }
  const text = normalizeText(raw);
  if (meaningfulLength(text) === 0) {
    throw new ExtractionError("파일에서 읽을 수 있는 글자가 없습니다. 내용이 있는 파일인지 확인해 주세요.", "empty");
  }
  return { text, method: METHOD_FOR_KIND[kind] };
}

/** 작업물 텍스트 추출 (A6 입력·미리보기). 회의록과 같은 추출기 + PPTX */
export async function extractDeliverableText(kind: MinutesKind | "pptx", bytes: Uint8Array): Promise<string> {
  if (kind === "pptx") return normalizeText(extractPptx(bytes));
  return (await extractMinutes(kind, bytes)).text;
}
