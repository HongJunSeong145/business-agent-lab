import mammoth from "mammoth";
import { ExtractionError, REUPLOAD_HINT } from "./errors";

export async function extractDocx(bytes: Uint8Array): Promise<string> {
  try {
    const r = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return r.value;
  } catch {
    throw new ExtractionError(`DOCX 파일을 읽을 수 없습니다(손상되었을 수 있음). ${REUPLOAD_HINT}`, "docx_corrupt");
  }
}
