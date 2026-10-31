import { unzipSync } from "fflate";

/**
 * 업로드 파일 형식 판정 (10-3): 확장자 허용 목록 + 매직바이트 일치 검사.
 * 실행 파일 등 허용 목록 밖의 형식은 모두 거부된다.
 */
export const MINUTES_KINDS = ["pdf", "docx", "hwpx", "hwp", "txt", "md"] as const;
export type MinutesKind = (typeof MINUTES_KINDS)[number];

export const KIND_MIME: Record<MinutesKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  hwpx: "application/hwp+zip",
  hwp: "application/x-hwp",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

export const SUPPORTED_LABEL = "HWPX, DOCX, PDF, TXT, MD (HWP는 최선 노력)";

function startsWith(b: Uint8Array, sig: number[]): boolean {
  return sig.every((v, i) => b[i] === v);
}
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function zipEntryNames(b: Uint8Array): string[] | null {
  try {
    // 내용은 풀지 않고 목록만 확인 (filter 가 false 를 돌려주면 압축 해제 안 함)
    const names: string[] = [];
    unzipSync(b, { filter: (f) => (names.push(f.name), false) });
    return names;
  } catch {
    return null;
  }
}

export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return m ? m[1]!.toLowerCase() : "";
}

/** 이름·내용을 함께 보고 형식을 결정한다. 불일치·미지원이면 UploadRejectedError. */
export function detectMinutesKind(fileName: string, bytes: Uint8Array): MinutesKind {
  const ext = extensionOf(fileName);
  if (!(MINUTES_KINDS as readonly string[]).includes(ext)) {
    throw new UploadRejectedError(`지원하지 않는 파일 형식입니다(.${ext || "확장자 없음"}). 지원 형식: ${SUPPORTED_LABEL}`);
  }
  if (bytes.byteLength === 0) throw new UploadRejectedError("빈 파일입니다.");
  const kind = ext as MinutesKind;
  const mismatch = () => new UploadRejectedError(`파일 내용이 .${ext} 형식이 아닙니다. 파일이 손상되었거나 확장자가 잘못되었습니다.`);

  switch (kind) {
    case "pdf":
      if (!startsWith(bytes, PDF)) throw mismatch();
      return kind;
    case "hwp":
      if (!startsWith(bytes, CFB)) throw mismatch();
      return kind;
    case "docx":
    case "hwpx": {
      if (!startsWith(bytes, ZIP)) throw mismatch();
      const names = zipEntryNames(bytes);
      if (!names) throw mismatch();
      const ok = kind === "docx" ? names.includes("word/document.xml") : names.some((n) => /^Contents\/section\d+\.xml$/i.test(n));
      if (!ok) throw mismatch();
      return kind;
    }
    case "txt":
    case "md": {
      const head = bytes.subarray(0, 8192);
      if (head.includes(0) && !isUtf16Bom(head)) throw new UploadRejectedError("텍스트 파일이 아닙니다(이진 데이터 포함).");
      return kind;
    }
  }
}

export function isUtf16Bom(b: Uint8Array): boolean {
  return (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff);
}
