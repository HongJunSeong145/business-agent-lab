import { unzipSync } from "fflate";
import { detectMinutesKind, extensionOf, UploadRejectedError, KIND_MIME, type MinutesKind } from "./detect";

/**
 * 작업물 형식 (8-7, 10-3): 허용 목록 + 매직바이트 검사.
 *  - 이미지: AI 가 직접 본다(A6)
 *  - 문서(PDF·DOCX·HWPX·HWP·PPTX·TXT·MD): 텍스트를 추출해 AI 가 읽는다
 *  - 동영상: 보관·미리보기만, AI 평가 불가 → 수동 진척도
 * SVG·HTML 등 브라우저에서 스크립트가 실행될 수 있는 형식은 받지 않는다.
 */
export const IMAGE_KINDS = ["png", "jpg", "jpeg", "gif", "webp"] as const;
export const VIDEO_KINDS = ["mp4", "mov", "webm"] as const;
export type DeliverableKind = MinutesKind | "pptx" | (typeof IMAGE_KINDS)[number] | (typeof VIDEO_KINDS)[number];

export const DELIVERABLE_MIME: Record<DeliverableKind, string> = {
  ...KIND_MIME,
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export const DELIVERABLE_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.pptx,.hwpx,.hwp,.txt,.md,.mp4,.mov,.webm";
export const DELIVERABLE_LABEL = "이미지(PNG·JPG·GIF·WEBP), PDF, DOCX, PPTX, HWPX, HWP, TXT, MD, 동영상(MP4·MOV·WEBM)";

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

export function detectDeliverableKind(fileName: string, bytes: Uint8Array): DeliverableKind {
  const ext = extensionOf(fileName);
  if (bytes.byteLength === 0) throw new UploadRejectedError("빈 파일입니다.");
  const mismatch = () => new UploadRejectedError(`파일 내용이 .${ext} 형식이 아닙니다. 파일이 손상되었거나 확장자가 잘못되었습니다.`);
  switch (ext) {
    case "png":
      if (!starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) throw mismatch();
      return ext;
    case "jpg":
    case "jpeg":
      if (!starts(bytes, [0xff, 0xd8, 0xff])) throw mismatch();
      return ext;
    case "gif":
      if (ascii(bytes, 0, 4) !== "GIF8") throw mismatch();
      return ext;
    case "webp":
      if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WEBP") throw mismatch();
      return ext;
    case "mp4":
    case "mov":
      if (ascii(bytes, 4, 8) !== "ftyp") throw mismatch();
      return ext;
    case "webm":
      if (!starts(bytes, [0x1a, 0x45, 0xdf, 0xa3])) throw mismatch();
      return ext;
    case "pptx": {
      if (!starts(bytes, [0x50, 0x4b, 0x03, 0x04])) throw mismatch();
      const names: string[] = [];
      try {
        unzipSync(bytes, { filter: (f) => (names.push(f.name), false) });
      } catch {
        throw mismatch();
      }
      if (!names.includes("ppt/presentation.xml")) throw mismatch();
      return ext;
    }
    default:
      try {
        return detectMinutesKind(fileName, bytes);
      } catch (e) {
        if (e instanceof UploadRejectedError && /지원하지 않는/.test(e.message)) {
          throw new UploadRejectedError(`지원하지 않는 파일 형식입니다(.${ext || "확장자 없음"}). 지원 형식: ${DELIVERABLE_LABEL}`);
        }
        throw e;
      }
  }
}

export function isImageMime(mime: string | null | undefined): boolean {
  return !!mime && /^image\/(png|jpeg|gif|webp)$/.test(mime);
}
export function isVideoMime(mime: string | null | undefined): boolean {
  return !!mime && mime.startsWith("video/");
}

/** 미리보기 방식 */
export function previewKind(mime: string | null | undefined): "image" | "pdf" | "video" | "text" | "link" | "none" {
  if (!mime) return "link";
  if (isImageMime(mime)) return "image";
  if (mime === "application/pdf") return "pdf";
  if (isVideoMime(mime)) return "video";
  return "text";
}
