import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { assertCan, type Actor } from "@/lib/auth/can";
import { writeAudit } from "@/lib/audit/log";
import { detectMinutesKind, extensionOf, KIND_MIME, UploadRejectedError } from "@/lib/files/detect";
import { newStorageKey, type Storage } from "@/lib/storage";
import { getNumberSetting, getPermissionSettings } from "@/lib/settings";
import { ServiceError } from "./invitations";

export const MEETING_TYPES = ["regular", "extraordinary", "department", "other"] as const;
export const MEETING_TYPE_LABEL: Record<(typeof MEETING_TYPES)[number], string> = {
  regular: "정기회의", extraordinary: "임시회의", department: "국서 회의", other: "기타",
};
export const MEETING_STATUS_LABEL: Record<string, string> = {
  uploaded: "대기 중", extracting: "추출 중", extracted: "추출 완료", analyzing: "분석 중",
  analyzed: "검토 대기", reviewed: "완료", failed: "실패",
};
export const MAX_PASTE_CHARS = 200_000;

const baseSchema = z.object({
  title: z.string().trim().max(150, "제목은 150자 이하로 입력하세요.").optional().transform((v) => v || undefined),
  meetingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "회의일을 선택하세요."),
  meetingType: z.enum(MEETING_TYPES, { message: "회의 유형을 선택하세요." }),
});

export type UploadInput =
  | (z.input<typeof baseSchema> & { kind: "file"; fileName: string; bytes: Uint8Array })
  | (z.input<typeof baseSchema> & { kind: "paste"; text: string });

/** 경로·제어문자 제거한 표시용 파일명 (저장 키에는 쓰지 않음) */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const clean = base.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return (clean || "file").slice(-200);
}

function titleFrom(input: UploadInput): string {
  if (input.kind === "file") return sanitizeFileName(input.fileName).replace(/\.[^.]+$/, "").slice(0, 150) || "회의록";
  const first = input.text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "회의록";
  return first.replace(/^#+\s*/, "").slice(0, 150);
}

/**
 * 회의록 등록 (PART 7 단계 1): 형식 검사 → 원본 저장 → meeting/meeting_files/ai_jobs 생성(한 트랜잭션) → 감사 로그.
 * 큐 전송은 트랜잭션 밖에서 호출 측이 dispatchJob 으로 한다(반환값 aiJobId).
 */
export async function createMeeting(db: Db, storage: Storage, actor: Actor & { termId: string }, input: UploadInput) {
  assertCan(actor, { type: "meeting.upload" }, await getPermissionSettings(db, actor.termId));
  const parsed = baseSchema.safeParse(input);
  if (!parsed.success) throw new ServiceError(parsed.error.issues[0]?.message ?? "입력값 오류");
  const meta = parsed.data;

  let fileName: string;
  let bytes: Uint8Array;
  if (input.kind === "file") {
    fileName = sanitizeFileName(input.fileName);
    bytes = input.bytes;
    const maxMb = await getNumberSetting(db, actor.termId, "UPLOAD_MAX_MB", Number(process.env.UPLOAD_MAX_MB ?? 50));
    if (bytes.byteLength > maxMb * 1024 * 1024) throw new ServiceError(`파일이 너무 큽니다(최대 ${maxMb}MB).`);
    try {
      detectMinutesKind(fileName, bytes);
    } catch (e) {
      if (e instanceof UploadRejectedError) throw new ServiceError(e.message);
      throw e;
    }
  } else {
    const text = input.text.trim();
    if (!text) throw new ServiceError("회의록 내용을 붙여넣어 주세요.");
    if (text.length > MAX_PASTE_CHARS) throw new ServiceError(`붙여넣은 내용이 너무 깁니다(최대 ${MAX_PASTE_CHARS.toLocaleString()}자). 파일로 올려 주세요.`);
    fileName = "붙여넣기.txt";
    bytes = new TextEncoder().encode(text);
  }

  const kind = extensionOf(fileName) as keyof typeof KIND_MIME;
  const storageKey = newStorageKey("minutes");
  await storage.put(storageKey, bytes, KIND_MIME[kind]);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  try {
    return await db.$transaction(async (tx) => {
      const meeting = await tx.meeting.create({
        data: {
          term_id: actor.termId,
          title: meta.title ?? titleFrom(input),
          meeting_date: new Date(`${meta.meetingDate}T00:00:00Z`),
          meeting_type: meta.meetingType,
          source: input.kind === "file" ? "upload" : "paste",
          status: "uploaded",
          uploaded_by: actor.userId,
        },
      });
      const file = await tx.meetingFile.create({
        data: {
          meeting_id: meeting.id,
          storage_key: storageKey,
          original_name: fileName,
          mime: KIND_MIME[kind],
          size: BigInt(bytes.byteLength),
          sha256,
        },
      });
      const job = await tx.aiJob.create({
        data: { type: "extract", payload: { meetingId: meeting.id, meetingFileId: file.id }, idempotency_key: `extract:${file.id}:1` },
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "meeting.upload",
        entityType: "meeting",
        entityId: meeting.id,
        diff: { source: meeting.source, kind, size: bytes.byteLength, sha256 },
      });
      return { meetingId: meeting.id, aiJobId: job.id };
    });
  } catch (e) {
    await storage.delete(storageKey).catch(() => undefined); // DB 실패 시 고아 파일 정리
    throw e;
  }
}

/** 다시 추출: 실패했거나 추출 완료된 회의록의 최신 파일에 새 추출 작업을 만든다 */
export async function requestReextract(db: Db, actor: Actor & { termId: string }, meetingId: string) {
  assertCan(actor, { type: "meeting.reanalyze" }, await getPermissionSettings(db, actor.termId));
  const meeting = await db.meeting.findFirst({
    where: { id: meetingId, term_id: actor.termId, deleted_at: null },
    include: { files: { orderBy: { created_at: "desc" }, take: 1 } },
  });
  if (!meeting) throw new ServiceError("회의록을 찾을 수 없습니다.", 404);
  if (meeting.status === "extracting" || meeting.status === "uploaded") throw new ServiceError("이미 추출 중입니다.");
  const file = meeting.files[0];
  if (!file) throw new ServiceError("원본 파일이 없습니다.");
  const count = await db.aiJob.count({ where: { type: "extract", idempotency_key: { startsWith: `extract:${file.id}:` } } });
  return db.$transaction(async (tx) => {
    await tx.meeting.update({ where: { id: meeting.id }, data: { status: "uploaded" } });
    const job = await tx.aiJob.create({
      data: { type: "extract", payload: { meetingId: meeting.id, meetingFileId: file.id }, idempotency_key: `extract:${file.id}:${count + 1}` },
    });
    await writeAudit(tx, { actorId: actor.userId, action: "meeting.reextract", entityType: "meeting", entityId: meeting.id });
    return { aiJobId: job.id };
  });
}

export type MeetingListFilter = { q?: string; from?: string; to?: string; type?: string };

export async function listMeetings(db: Db, termId: string, f: MeetingListFilter) {
  const dateOk = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : undefined);
  return db.meeting.findMany({
    where: {
      term_id: termId,
      deleted_at: null,
      ...(f.q ? { title: { contains: f.q, mode: "insensitive" as const } } : {}),
      ...(f.type && (MEETING_TYPES as readonly string[]).includes(f.type) ? { meeting_type: f.type } : {}),
      meeting_date: { gte: dateOk(f.from), lte: dateOk(f.to) },
    },
    orderBy: [{ meeting_date: "desc" }, { created_at: "desc" }],
    take: 200,
    select: { id: true, title: true, meeting_date: true, meeting_type: true, status: true, source: true, is_demo: true },
  });
}

export async function getMeetingDetail(db: Db, termId: string, id: string) {
  return db.meeting.findFirst({
    where: { id, term_id: termId, deleted_at: null },
    include: {
      uploader: { select: { display_name: true } },
      files: { orderBy: { created_at: "desc" } },
      analyses: { orderBy: { version: "desc" }, take: 1 },
    },
  });
}

/** 정리본 편집 (8-3): 편집본은 새 버전으로 저장, 근거(문단·인용)는 다시 검증 */
export async function editAnalysis(db: Db, actor: Actor & { termId: string }, meetingId: string, raw: unknown) {
  assertCan(actor, { type: "meeting.reanalyze" }, await getPermissionSettings(db, actor.termId));
  const { a1Schema } = await import("@/lib/ai/schemas/a1");
  const { groundAll } = await import("@/lib/ai/grounding");
  const { toParagraphs } = await import("@/lib/minutes-text");
  const { maskText } = await import("@/lib/audit/mask");
  const r = a1Schema.safeParse((raw as { summary?: unknown } | null)?.summary);
  if (!r.success) throw new ServiceError(`정리본 형식 오류: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}`);
  const m = await db.meeting.findFirst({
    where: { id: meetingId, term_id: actor.termId, deleted_at: null },
    include: { files: { take: 1, orderBy: { created_at: "desc" } }, analyses: { take: 1, orderBy: { version: "desc" } } },
  });
  if (!m) throw new ServiceError("회의록을 찾을 수 없습니다.", 404);
  const paras = toParagraphs(m.files[0]?.extracted_text ?? "").map((p) => ({ n: p.n, text: maskText(p.text) }));
  const summary = groundAll(r.data, paras);
  return db.$transaction(async (tx) => {
    const a = await tx.meetingAnalysis.create({
      data: { meeting_id: meetingId, version: (m.analyses[0]?.version ?? 0) + 1, summary: summary as object, model: "user-edit", prompt_version: m.analyses[0]?.prompt_version ?? null, edited_by: actor.userId },
    });
    await writeAudit(tx, { actorId: actor.userId, action: "meeting.analysis_edit", entityType: "meeting", entityId: meetingId, diff: { version: a.version } });
    return { version: a.version };
  });
}
