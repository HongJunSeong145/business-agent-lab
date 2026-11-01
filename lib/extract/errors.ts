/** 추출 실패 — message 는 사용자에게 그대로 보여주는 안내 문구 (D14, T1) */
export class ExtractionError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

export const REUPLOAD_HINT = "PDF(텍스트 포함) 또는 HWPX로 저장해 다시 올려 주세요.";
