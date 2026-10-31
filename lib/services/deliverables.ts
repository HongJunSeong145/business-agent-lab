import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { assertCan, can, isLeader, type Actor } from "@/lib/auth/can";
import { writeAudit } from "@/lib/audit/log";
import { UploadRejectedError } from "@/lib/files/detect";
import { DELIVERABLE_MIME, detectDeliverableKind, isImageMime, isVideoMime, previewKind, type DeliverableKind } from "@/lib/files/deliverable";
import { extractDeliverableText } from "@/lib/extract";
import { newStorageKey, type Storage } from "@/lib/storage";
import { signedFileUrl } from "@/lib/storage/signed-url";
import { getNumberSetting } from "@/lib/settings";
import { aiAvailable } from "@/lib/ai/runtime";
import { sanitizeFileName } from "./meetings";
import { loadTask, taskResource } from "./tasks";
import { ServiceError } from "./invitations";

/**
 * 작업물 (8-7 작업물 탭, PART 7 단계 10~11, T12·T13).
 *  - 업로드할 때마다 버전이 쌓인다(같은 작업물에 새 버전 / 새 작업물).
 *  - 원본은 저장소에, 내려받기는 로그인 + 10분 서명 URL + 기수 확인(app/api/files).
 *  - 평가 가능한 형식이면 A6 평가 작업을 등록한다(AI 를 못 쓰면 등록하지 않음 — 수동 진척도는 그대로).
 */
type ActorT = Actor & { termId: string };

/** Claude 이미지 입력 한도(5MB)보다 작게 */
export const MAX_EVAL_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;
const TEXT_KINDS = new Set(["pdf", "docx", "pptx", "hwpx", "hwp", "txt", "md"]);

export type EvaluableReason = "ok" | "video" | "image_too_large" | "no_text" | "link" | "unknown";

/** A6 가 평가할 수 있는 버전인가 (8-7: 동영상 등은 "AI 평가 불가 — 수동 진척도 입력") */
export function evaluability(v: { mime: string | null; size: bigint | number | null; extracted_text: string | null; external_url: string | null; storage_key: string | null }): EvaluableReason {
  if (!v.storage_key) return v.external_url ? "link" : "unknown";
  if (isVideoMime(v.mime)) return "video";
  if (isImageMime(v.mime)) return Number(v.size ?? 0) <= MAX_EVAL_IMAGE_BYTES ? "ok" : "image_too_large";
  return v.extracted_text && v.extracted_text.trim() ? "ok" : "no_text";
}

export const NOT_EVALUABLE_LABEL: Record<Exclude<EvaluableReason, "ok">, string> = {
  video: "동영상은 AI가 평가할 수 없습니다",
  image_too_large: "이미지가 5MB를 넘어 AI가 평가할 수 없습니다",
  no_text: "글자를 읽을 수 없어(스캔본 등) AI가 평가할 수 없습니다",
  link: "외부 링크는 AI가 열어 볼 수 없습니다",
  unknown: "AI가 평가할 수 없는 형식입니다",
};

const metaSchema = z.object({
  taskId: z.string().uuid(),
  deliverableId: z.string().uuid().optional(),
  /** true 면 deliverableId 없이도 가장 최근 작업물의 새 버전으로(업무 행 드래그 앤 드롭) — 작업물이 없으면 새 작업물 */
  appendToLatest: z.boolean().optional(),
  title: z.string().trim().max(150).optional().transform((v) => v || undefined),
  note: z.string().trim().max(2000).optional().transform((v) => v || undefined),
  externalUrl: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => v || undefined)
    .refine((v) => !v || /^https?:\/\/[^\s]+$/i.test(v), "링크는 http:// 또는 https:// 로 시작해야 합니다."),
});

export type UploadDeliverableInput = z.input<typeof metaSchema> & { file?: { name: string; bytes: Uint8Array } };

export async function uploadDeliverable(db: Db, storage: Storage, actor: ActorT, input: UploadDeliverableInput, available = aiAvailable()) {
  const parsed = metaSchema.safeParse(input);
  if (!parsed.success) throw new ServiceError(parsed.error.issues[0]?.message ?? "입력값 오류");
  const meta = parsed.data;
  const task = await loadTask(db, actor.termId, meta.taskId);
  assertCan(actor, { type: "deliverable.upload", task: taskResource(task) });
  if (task.status === "cancelled") throw new ServiceError("취소된 업무에는 올릴 수 없습니다.");
  if (!input.file && !meta.externalUrl) throw new ServiceError("파일을 고르거나 링크를 입력하세요.");

  let deliverable: { id: string; title: string } | null = null;
  if (meta.deliverableId) {
    deliverable = await db.deliverable.findFirst({ where: { id: meta.deliverableId, task_id: task.id, deleted_at: null }, select: { id: true, title: true } });
    if (!deliverable) throw new ServiceError("작업물을 찾을 수 없습니다.", 404);
  } else if (meta.appendToLatest) {
    deliverable = await db.deliverable.findFirst({ where: { task_id: task.id, deleted_at: null }, orderBy: { updated_at: "desc" }, select: { id: true, title: true } });
  }

  let file: { name: string; kind: DeliverableKind; bytes: Uint8Array; key: string; sha256: string; text: string | null } | null = null;
  if (input.file) {
    const name = sanitizeFileName(input.file.name);
    const bytes = input.file.bytes;
    const maxMb = await getNumberSetting(db, actor.termId, "UPLOAD_MAX_MB", Number(process.env.UPLOAD_MAX_MB ?? 50));
    if (bytes.byteLength > maxMb * 1024 * 1024) throw new ServiceError(`파일이 너무 큽니다(최대 ${maxMb}MB).`);
    let kind: DeliverableKind;
    try {
      kind = detectDeliverableKind(name, bytes);
    } catch (e) {
      if (e instanceof UploadRejectedError) throw new ServiceError(e.message);
      throw e;
    }
    let text: string | null = null;
    if (TEXT_KINDS.has(kind)) {
      // 미리보기·AI 평가용. 읽지 못해도 업로드는 받는다(스캔 PDF 등 → AI 평가 불가 표시)
      text = await extractDeliverableText(kind as Parameters<typeof extractDeliverableText>[0], bytes).then((t) => t.slice(0, MAX_TEXT_CHARS), () => null);
    }
    file = { name, kind, bytes, key: newStorageKey("deliverables"), sha256: createHash("sha256").update(bytes).digest("hex"), text };
    await storage.put(file.key, bytes, DELIVERABLE_MIME[kind]);
  }

  try {
    return await db.$transaction(async (tx) => {
      const d =
        deliverable ??
        (await tx.deliverable.create({
          data: { task_id: task.id, title: meta.title ?? (file ? file.name.replace(/\.[^.]+$/, "") : "링크 작업물").slice(0, 150) },
          select: { id: true, title: true },
        }));
      // 같은 작업물에 동시에 올려도 버전 번호가 겹치지 않도록 행 잠금
      await tx.$queryRaw`SELECT id FROM deliverables WHERE id = ${d.id}::uuid FOR UPDATE`;
      const last = await tx.deliverableVersion.aggregate({ where: { deliverable_id: d.id }, _max: { version_no: true } });
      const versionNo = (last._max.version_no ?? 0) + 1;
      const v = await tx.deliverableVersion.create({
        data: {
          deliverable_id: d.id,
          version_no: versionNo,
          storage_key: file?.key ?? null,
          external_url: file ? null : meta.externalUrl!,
          original_name: file?.name ?? null,
          mime: file ? DELIVERABLE_MIME[file.kind] : null,
          size: file ? BigInt(file.bytes.byteLength) : null,
          sha256: file?.sha256 ?? null,
          note: meta.note ?? null,
          uploaded_by: actor.userId,
          extracted_text: file?.text ?? null,
          thumbnail_key: file && isImageMime(DELIVERABLE_MIME[file.kind]) ? file.key : null,
        },
      });
      await tx.deliverable.update({ where: { id: d.id }, data: { current_version_id: v.id } });
      if (task.status === "todo") {
        await tx.task.update({ where: { id: task.id }, data: { status: "in_progress" } });
        await writeAudit(tx, { actorId: null, actorKind: "system", action: "task.auto_status", entityType: "task", entityId: task.id, diff: { before: "todo", after: "in_progress", reason: "작업물 업로드" } });
      }
      let aiJobId: string | null = null;
      if (available && evaluability(v) === "ok") {
        const job = await tx.aiJob.create({ data: { type: "evaluate_deliverable", payload: { versionId: v.id, taskId: task.id }, idempotency_key: `evaluate:${v.id}:1` } });
        aiJobId = job.id;
      }
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "deliverable.upload",
        entityType: "task",
        entityId: task.id,
        diff: { deliverableId: d.id, title: d.title, version: versionNo, kind: file?.kind ?? "link", size: file?.bytes.byteLength ?? null, sha256: file?.sha256 ?? null },
      });
      return { deliverableId: d.id, versionId: v.id, versionNo, aiJobId };
    });
  } catch (e) {
    if (file) await storage.delete(file.key).catch(() => undefined);
    throw e;
  }
}

/** 다시 평가 (평가 실패·새 기준 반영) */
export async function requestEvaluation(db: Db, actor: ActorT, versionId: string, available = aiAvailable()) {
  const v = await db.deliverableVersion.findFirst({ where: { id: versionId, deleted_at: null, deliverable: { deleted_at: null } }, include: { deliverable: true } });
  if (!v) throw new ServiceError("작업물 버전을 찾을 수 없습니다.", 404);
  const task = await loadTask(db, actor.termId, v.deliverable.task_id);
  assertCan(actor, { type: "deliverable.upload", task: taskResource(task) });
  if (!available) throw new ServiceError("AI 일시 사용 불가 — 진척도는 직접 입력할 수 있습니다.", 503);
  const reason = evaluability(v);
  if (reason !== "ok") throw new ServiceError(`${NOT_EVALUABLE_LABEL[reason]} — 수동 진척도를 입력하세요.`);
  const jobs = await db.aiJob.findMany({ where: { type: "evaluate_deliverable", payload: { path: ["versionId"], equals: versionId } }, select: { status: true } });
  if (jobs.some((j) => j.status === "queued" || j.status === "running")) throw new ServiceError("이미 평가 중입니다.");
  const job = await db.$transaction(async (tx) => {
    const j = await tx.aiJob.create({ data: { type: "evaluate_deliverable", payload: { versionId, taskId: task.id }, idempotency_key: `evaluate:${versionId}:${jobs.length + 1}` } });
    await writeAudit(tx, { actorId: actor.userId, action: "deliverable.reevaluate", entityType: "task", entityId: task.id, diff: { versionId } });
    return j;
  });
  return { aiJobId: job.id };
}

/** 작업물 삭제(소프트 삭제 4-1) — 국장 이상 또는 처음 올린 사람 */
export async function deleteDeliverable(db: Db, actor: ActorT, deliverableId: string) {
  const d = await db.deliverable.findFirst({ where: { id: deliverableId, deleted_at: null }, include: { versions: { orderBy: { version_no: "asc" }, take: 1 } } });
  if (!d) throw new ServiceError("작업물을 찾을 수 없습니다.", 404);
  await loadTask(db, actor.termId, d.task_id);
  if (!isLeader(actor) && d.versions[0]?.uploaded_by !== actor.userId) throw new ServiceError("올린 사람이나 국장만 삭제할 수 있습니다.", 403);
  await db.$transaction(async (tx) => {
    await tx.deliverable.update({ where: { id: d.id }, data: { deleted_at: new Date() } });
    await writeAudit(tx, { actorId: actor.userId, action: "deliverable.delete", entityType: "task", entityId: d.task_id, diff: { deliverableId: d.id, title: d.title } });
  });
}

export type EvaluationView = {
  id: string;
  score: number;
  criteria: { criterion: string; verdict: "met" | "partial" | "unmet"; evidence: string }[];
  missing_items: string[];
  suggestions: string[];
  summary: string | null;
  model: string | null;
  at: Date;
};

/** 작업물 탭 데이터 — 모든 구성원 열람 가능(8-7) */
export async function listDeliverables(db: Db, actor: ActorT, taskId: string, available = aiAvailable()) {
  const task = await loadTask(db, actor.termId, taskId);
  assertCan(actor, { type: "deliverable.view" });
  const ds = await db.deliverable.findMany({
    where: { task_id: task.id, deleted_at: null },
    orderBy: { created_at: "asc" },
    include: { versions: { where: { deleted_at: null }, orderBy: { version_no: "desc" }, include: { evaluations: { orderBy: { created_at: "desc" }, take: 1 } } } },
  });
  const versionIds = ds.flatMap((d) => d.versions.map((v) => v.id));
  const jobs = versionIds.length
    ? await db.aiJob.findMany({ where: { type: "evaluate_deliverable", OR: versionIds.map((id) => ({ payload: { path: ["versionId"], equals: id } })) }, orderBy: { created_at: "desc" } })
    : [];
  const userIds = [...new Set(ds.flatMap((d) => d.versions.map((v) => v.uploaded_by)))];
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, display_name: true } });
  const res = taskResource(task);
  return {
    canUpload: can(actor, { type: "deliverable.upload", task: res }) && task.status !== "cancelled",
    aiAvailable: available,
    deliverables: ds.map((d) => ({
      id: d.id,
      title: d.title,
      currentVersionId: d.current_version_id,
      canDelete: isLeader(actor) || d.versions.at(-1)?.uploaded_by === actor.userId,
      versions: d.versions.map((v) => {
        const job = jobs.find((j) => (j.payload as { versionId?: string }).versionId === v.id);
        const ev = v.evaluations[0];
        const rubric = (ev?.rubric_results ?? null) as { items?: EvaluationView["criteria"]; summary?: string } | null;
        const reason = evaluability(v);
        return {
          id: v.id,
          versionNo: v.version_no,
          fileName: v.original_name,
          mime: v.mime,
          size: v.size === null ? null : Number(v.size),
          note: v.note,
          externalUrl: v.external_url,
          uploadedBy: users.find((u) => u.id === v.uploaded_by)?.display_name ?? null,
          at: v.created_at,
          preview: v.external_url ? ("link" as const) : previewKind(v.mime),
          url: v.storage_key ? signedFileUrl(v.storage_key) : null,
          downloadUrl: v.storage_key ? signedFileUrl(v.storage_key, { download: true }) : null,
          textExcerpt: v.extracted_text ? v.extracted_text.slice(0, 4000) : null,
          evaluable: reason === "ok",
          notEvaluableReason: reason === "ok" ? null : NOT_EVALUABLE_LABEL[reason],
          evaluationStatus: job ? (job.status as "queued" | "running" | "succeeded" | "failed" | "waiting_budget") : null,
          evaluationError: job?.status === "failed" ? job.error : null,
          evaluation: ev
            ? ({
                id: ev.id,
                score: ev.score,
                criteria: rubric?.items ?? [],
                missing_items: (ev.missing_items as string[] | null) ?? [],
                suggestions: (ev.suggestions as string[] | null) ?? [],
                summary: rubric?.summary ?? null,
                model: ev.model,
                at: ev.created_at,
              } satisfies EvaluationView)
            : null,
        };
      }),
    })),
  };
}
