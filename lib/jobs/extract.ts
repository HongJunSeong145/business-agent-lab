import type { Db } from "@/lib/db";
import { detectMinutesKind, UploadRejectedError } from "@/lib/files/detect";
import { extractMinutes, ExtractionError } from "@/lib/extract";
import type { Storage } from "@/lib/storage";

export const MAX_ATTEMPTS = 3;
export const TRANSIENT_FAILURE_MESSAGE = "일시적인 오류로 텍스트를 추출하지 못했습니다. 잠시 후 '다시 추출'을 눌러 주세요.";

export type ExtractOutcome = "extracted" | "failed" | "skipped";

/**
 * 회의록 텍스트 추출 작업 (PART 7 단계 2).
 * 상태: meeting uploaded → extracting → extracted | failed
 *  - ai_jobs 를 조건부 업데이트로 '선점'하므로 같은 작업이 두 번 실행되지 않는다(중복 전송·재시도 안전).
 *  - 파일 내용 문제(ExtractionError)는 재시도하지 않고 실패 + 안내 문구로 확정.
 *  - 그 밖의 예외는 다시 던져 큐가 재시도하게 하고, 마지막 시도면 실패로 확정.
 */
export async function runExtractJob(db: Db, storage: Storage, aiJobId: string, now = () => new Date()): Promise<ExtractOutcome> {
  const claimed = await db.aiJob.updateMany({
    where: { id: aiJobId, type: "extract", status: "queued" },
    data: { status: "running", started_at: now(), attempts: { increment: 1 }, error: null },
  });
  if (claimed.count !== 1) return "skipped";

  const job = await db.aiJob.findUniqueOrThrow({ where: { id: aiJobId } });
  const { meetingFileId } = job.payload as { meetingFileId: string };
  const file = await db.meetingFile.findUnique({ where: { id: meetingFileId }, include: { meeting: true } });
  if (!file || file.meeting.deleted_at) {
    await db.aiJob.update({ where: { id: aiJobId }, data: { status: "failed", error: "meeting_missing", finished_at: now() } });
    return "failed";
  }
  await db.meeting.update({ where: { id: file.meeting_id }, data: { status: "extracting" } });

  const fail = async (message: string, code: string) => {
    await db.$transaction([
      db.meetingFile.update({ where: { id: file.id }, data: { extraction_error: message, extracted_text: null } }),
      db.meeting.update({ where: { id: file.meeting_id }, data: { status: "failed" } }),
      db.aiJob.update({ where: { id: aiJobId }, data: { status: "failed", error: code, finished_at: now() } }),
      db.activityLog.create({
        data: { actor_kind: "system", action: "meeting.extract_failed", entity_type: "meeting", entity_id: file.meeting_id, diff: { code } },
      }),
    ]);
    return "failed" as const;
  };

  try {
    if (!file.storage_key || !file.original_name) return await fail("원본 파일 정보가 없습니다. 다시 올려 주세요.", "no_source");
    const bytes = await storage.get(file.storage_key);
    if (!bytes) return await fail("저장된 원본 파일을 찾을 수 없습니다. 다시 올려 주세요.", "source_missing");
    const kind = detectMinutesKind(file.original_name, bytes);
    const result = await extractMinutes(kind, bytes);
    const method = file.meeting.source === "paste" ? "paste" : result.method;
    await db.$transaction([
      db.meetingFile.update({ where: { id: file.id }, data: { extracted_text: result.text, extraction_method: method, extraction_error: null } }),
      db.meeting.update({ where: { id: file.meeting_id }, data: { status: "extracted" } }),
      db.aiJob.update({ where: { id: aiJobId }, data: { status: "succeeded", finished_at: now() } }),
      db.activityLog.create({
        data: { actor_kind: "system", action: "meeting.extracted", entity_type: "meeting", entity_id: file.meeting_id, diff: { method, chars: result.text.length } },
      }),
    ]);
    return "extracted";
  } catch (e) {
    if (e instanceof ExtractionError) return await fail(e.message, e.code);
    if (e instanceof UploadRejectedError) return await fail(e.message, "rejected");
    const attempts = (await db.aiJob.findUniqueOrThrow({ where: { id: aiJobId } })).attempts;
    if (attempts >= MAX_ATTEMPTS) return await fail(TRANSIENT_FAILURE_MESSAGE, "transient_exhausted");
    // 큐 재시도를 위해 queued 로 되돌리고 예외 전달
    await db.aiJob.update({ where: { id: aiJobId }, data: { status: "queued", error: e instanceof Error ? e.message.slice(0, 500) : "error" } });
    await db.meeting.update({ where: { id: file.meeting_id }, data: { status: "uploaded" } });
    throw e;
  }
}
