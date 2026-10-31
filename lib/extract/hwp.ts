import * as CFB from "cfb";
import { inflateSync } from "fflate";
import { ExtractionError, REUPLOAD_HINT } from "./errors";

/**
 * HWP 5.0(바이너리) 최선 노력 추출 (D14).
 *  1) FileHeader 확인(암호 문서 거부) → BodyText/SectionN 레코드의 PARA_TEXT(태그 67)에서 본문 추출
 *  2) 실패하면 PrvText(미리보기 텍스트, 앞부분만) 사용
 *  3) 둘 다 실패하면 PDF/HWPX 재업로드 안내
 */
const HWPTAG_PARA_TEXT = 67;
// 8 WCHAR 를 차지하는 컨트롤 문자 (인라인·확장 컨트롤)
const WIDE_CONTROLS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

const FAIL = `HWP 파일에서 글자를 읽지 못했습니다. ${REUPLOAD_HINT}`;

export function decodeParaText(buf: Uint8Array): string {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let s = "";
  for (let i = 0; i + 1 < buf.byteLength; ) {
    const c = dv.getUint16(i, true);
    if (c < 32) {
      if (c === 9) s += "\t";
      else if (c === 10) s += "\n";
      i += WIDE_CONTROLS.has(c) ? 16 : 2;
      continue;
    }
    s += String.fromCharCode(c);
    i += 2;
  }
  return s;
}

export function paraTextsFromRecords(data: Uint8Array): string[] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: string[] = [];
  let i = 0;
  while (i + 4 <= data.byteLength) {
    const header = dv.getUint32(i, true);
    i += 4;
    const tag = header & 0x3ff;
    let size = (header >>> 20) & 0xfff;
    if (size === 0xfff) {
      if (i + 4 > data.byteLength) break;
      size = dv.getUint32(i, true);
      i += 4;
    }
    if (i + size > data.byteLength) break;
    if (tag === HWPTAG_PARA_TEXT) out.push(decodeParaText(data.subarray(i, i + size)));
    i += size;
  }
  return out;
}

function toU8(content: unknown): Uint8Array {
  if (content instanceof Uint8Array) return content;
  return Uint8Array.from(content as ArrayLike<number>);
}

export function extractHwp(bytes: Uint8Array): string {
  let cfb: CFB.CFB$Container;
  try {
    cfb = CFB.read(Buffer.from(bytes), { type: "buffer" });
  } catch {
    throw new ExtractionError(`HWP 파일을 열 수 없습니다(손상되었을 수 있음). ${REUPLOAD_HINT}`, "hwp_corrupt");
  }
  const header = CFB.find(cfb, "/FileHeader");
  if (!header?.content) throw new ExtractionError(FAIL, "hwp_no_header");
  const h = toU8(header.content);
  const signature = new TextDecoder("latin1").decode(h.subarray(0, 17));
  if (signature !== "HWP Document File") throw new ExtractionError(FAIL, "hwp_signature");
  const flags = new DataView(h.buffer, h.byteOffset, h.byteLength).getUint32(36, true);
  const compressed = (flags & 1) !== 0;
  if ((flags & 2) !== 0) throw new ExtractionError(`암호가 걸린 HWP 문서는 읽을 수 없습니다. 암호를 해제하거나 ${REUPLOAD_HINT}`, "hwp_encrypted");
  if ((flags & 4) !== 0) throw new ExtractionError(`배포용 HWP 문서는 읽을 수 없습니다. ${REUPLOAD_HINT}`, "hwp_distribution");

  const sections = cfb.FullPaths
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => /\/BodyText\/Section\d+$/i.test(p))
    .sort((a, b) => Number(/(\d+)$/.exec(a.p)![1]) - Number(/(\d+)$/.exec(b.p)![1]));

  const lines: string[] = [];
  for (const { idx } of sections) {
    try {
      const raw = toU8(cfb.FileIndex[idx]!.content);
      const data = compressed ? inflateSync(raw) : raw;
      for (const t of paraTextsFromRecords(data)) if (t.trim()) lines.push(t);
    } catch {
      // 해당 구역만 건너뛰고 미리보기 텍스트로 보완
    }
  }
  if (lines.join("").trim()) return lines.join("\n");

  const prv = CFB.find(cfb, "/PrvText");
  if (prv?.content) {
    const text = new TextDecoder("utf-16le").decode(toU8(prv.content)).replace(/>\s*</g, "\n").replace(/[<>]/g, "");
    if (text.trim()) return `${text}\n\n[안내] HWP 본문 해석에 실패해 미리보기 텍스트(앞부분)만 추출했습니다. 전체 내용은 PDF 또는 HWPX로 다시 올려 주세요.`;
  }
  throw new ExtractionError(FAIL, "hwp_no_text");
}
