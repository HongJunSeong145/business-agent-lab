import { isUtf16Bom } from "@/lib/files/detect";

/** TXT/MD 디코딩: UTF-8(BOM 포함) → UTF-16(BOM) → 실패 시 EUC-KR(CP949, 한글 Windows 메모장 기본값) */
export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  if (isUtf16Bom(bytes)) {
    const le = bytes[0] === 0xff;
    return { text: new TextDecoder(le ? "utf-16le" : "utf-16be").decode(bytes.subarray(2)), encoding: le ? "utf-16le" : "utf-16be" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("euc-kr").decode(bytes), encoding: "euc-kr" };
  }
}
