import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { assertCan, can, isLeader, type Actor } from "@/lib/auth/can";
import { writeAudit } from "@/lib/audit/log";
import { UploadRejectedError } from "@/lib/files/detect";
import { DELIVERABLE_MIME, detectDeliverableKind, previewKind } from "@/lib/files/deliverable";
import { newStorageKey, type Storage } from "@/lib/storage";
import { signedFileUrl } from "@/lib/storage/signed-url";
import { getNumberSetting } from "@/lib/settings";
import { aiAvailable } from "@/lib/ai/runtime";
import { sanitizeFileName } from "./meetings";
import { loadTask, taskResource } from "./tasks";
import { planForContext } from "./plans";
import { ServiceError } from "./invitations";

/**
 * 레퍼런스 (8-7 레퍼런스 탭, D11, T19).
 *  - 사용자: 링크·파일 추가/삭제
 *  - AI(A5): '레퍼런스 제작 의뢰' → 웹 검색 레퍼런스(출처 링크·요약·벤치마킹 포인트) + 국서 형식 예시안
 *  - 의뢰 시 사용한 회의록 분석·기획안 버전·과거 작업물을 context_snapshot 에 기록한다(T19).
 */
type ActorT = Actor & { termId: string };
type Tx = Prisma.TransactionClient;

const addSchema = z.object({
  title: z.string().trim().max(200).optional().transform((v) => v || undefined),
  url: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => v || undefined)
    .refine((v) => !v || /^https?:\/\/[^\s]+$/i.test(v), "링크는 http:// 또는 https:// 로 시작해야 합니다."),
  note: z.string().trim().max(1000).optional().transform((v) => v || undefined),
});

export async function addReference(db: Db, storage: Storage, actor: ActorT, taskId: string, input: z.input<typeof addSchema> & { file?: { name: string; bytes: Uint8Array } }) {
  const v = addSchema.safeParse(input);
  if (!v.success) throw new ServiceError(v.error.issues[0]?.message ?? "입력값 오류");
  const task = await loadTask(db, actor.termId, taskId);
  assertCan(actor, { type: "reference.add", task: taskResource(task) });
  if (!input.file && !v.data.url) throw new ServiceError("링크를 입력하거나 파일을 고르세요.");
  let file: { key: string; name: string; mime: string } | null = null;
  if (input.file) {
    const name = sanitizeFileName(input.file.name);
    const maxMb = await getNumberSetting(db, actor.termId, "UPLOAD_MAX_MB", Number(process.env.UPLOAD_MAX_MB ?? 50));
    if (input.file.bytes.byteLength > maxMb * 1024 * 1024) throw new ServiceError(`파일이 너무 큽니다(최대 ${maxMb}MB).`);
    let kind;
    try {
      kind = detectDeliverableKind(name, input.file.bytes);
    } catch (e) {
      if (e instanceof UploadRejectedError) throw new ServiceError(e.message);
      throw e;
    }
    file = { key: newStorageKey("references"), name, mime: DELIVERABLE_MIME[kind] };
    await storage.put(file.key, input.file.bytes, file.mime);
  }
  try {
    return await db.$transaction(async (tx) => {
      const lead = task.departments.find((d) => d.role === "lead");
      const item = await tx.referenceItem.create({
        data: {
          task_id: task.id,
          project_id: task.project_id,
          department_id: lead?.department_id ?? null,
          kind: file ? "file" : "link",
          title: (v.data.title ?? file?.name ?? v.data.url!).slice(0, 200),
          url: file ? null : v.data.url!,
          storage_key: file?.key ?? null,
          original_name: file?.name ?? null,
          mime: file?.mime ?? null,
          summary: v.data.note ?? null,
          origin: "user",
          created_by: actor.userId,
        },
      });
      await writeAudit(tx, {
        actorId: actor.userId, action: "reference.add", entityType: "task", entityId: task.id,
        diff: { referenceId: item.id, kind: item.kind, sha256: input.file ? createHash("sha256").update(input.file.bytes).digest("hex") : null },
      });
      return item;
    });
  } catch (e) {
    if (file) await storage.delete(file.key).catch(() => undefined);
    throw e;
  }
}

/** 삭제: 추가한 사람 또는 국장 이상. AI 레퍼런스는 의뢰한 사람 또는 국장 이상 */
export async function deleteReference(db: Db, actor: ActorT, id: string) {
  const item = await db.referenceItem.findFirst({ where: { id, deleted_at: null }, include: { request: true } });
  if (!item?.task_id) throw new ServiceError("레퍼런스를 찾을 수 없습니다.", 404);
  await loadTask(db, actor.termId, item.task_id);
  const owner = item.created_by ?? item.request?.requested_by ?? null;
  if (!isLeader(actor) && owner !== actor.userId) throw new ServiceError("추가한 사람이나 국장만 삭제할 수 있습니다.", 403);
  await db.$transaction(async (tx) => {
    await tx.referenceItem.update({ where: { id }, data: { deleted_at: new Date() } });
    await writeAudit(tx, { actorId: actor.userId, action: "reference.delete", entityType: "task", entityId: item.task_id!, diff: { referenceId: id, title: item.title } });
  });
}

/** 업무와 연결된 회의록(업무를 만든 제안의 회의록 → 같은 사업 업무의 회의록 순) */
export async function meetingForTask(db: Db | Tx, task: { source_proposal_id: string | null; project_id: string | null }) {
  const proposalIds: string[] = [];
  if (task.source_proposal_id) proposalIds.push(task.source_proposal_id);
  if (task.project_id) {
    const siblings = await db.task.findMany({ where: { project_id: task.project_id, source_proposal_id: { not: null } }, select: { source_proposal_id: true }, orderBy: { created_at: "desc" }, take: 20 });
    proposalIds.push(...siblings.map((s) => s.source_proposal_id!));
  }
  for (const pid of proposalIds) {
    const p = await db.proposal.findUnique({ where: { id: pid }, select: { source_type: true, source_id: true } });
    if (p?.source_type !== "meeting" || !p.source_id) continue;
    const m = await db.meeting.findFirst({ where: { id: p.source_id, deleted_at: null }, include: { analyses: { orderBy: { version: "desc" }, take: 1 } } });
    if (m?.analyses[0]) return { meetingId: m.id, title: m.title, analysisId: m.analyses[0].id, analysisVersion: m.analyses[0].version, summary: m.analyses[0].summary };
  }
  return null;
}

/** 과거 유사 업무의 완료 작업물(같은 표준 업무 또는 같은 주관 국서·비슷한 제목) */
export async function pastWorkForTask(db: Db | Tx, task: { id: string; template_key: string | null; title: string; departments: { role: string; department_id: string }[] }) {
  const lead = task.departments.find((d) => d.role === "lead")?.department_id;
  const words = task.title.split(/\s+/).filter((w) => w.length >= 2).slice(0, 4);
  const similar = await db.task.findMany({
    where: {
      id: { not: task.id },
      deleted_at: null,
      is_completed: true,
      OR: [
        ...(task.template_key ? [{ template_key: task.template_key }] : []),
        ...(lead ? [{ departments: { some: { role: "lead", department_id: lead } }, OR: words.map((w) => ({ title: { contains: w } })) }] : []),
      ],
      deliverables: { some: { deleted_at: null } },
    },
    include: { deliverables: { where: { deleted_at: null }, include: { versions: { where: { deleted_at: null, extracted_text: { not: null } }, orderBy: { version_no: "desc" }, take: 1 } } } },
    orderBy: { completed_at: "desc" },
    take: 3,
  });
  return similar.flatMap((t) => t.deliverables.flatMap((d) => d.versions.map((v) => ({ taskTitle: t.title, deliverableTitle: d.title, versionId: v.id, text: v.extracted_text!.slice(0, 4000) }))));
}

const requestSchema = z.object({
  instruction: z.string().trim().max(2000).optional().transform((v) => v || null),
  useMinutes: z.boolean().default(true),
  usePlan: z.boolean().default(true),
  usePastWork: z.boolean().default(false),
});

/** 레퍼런스 제작 의뢰 (8-7 모달) → A5 작업 */
export async function requestReferences(db: Db, actor: ActorT, taskId: string, raw: unknown, available = aiAvailable()) {
  const v = requestSchema.safeParse(raw ?? {});
  if (!v.success) throw new ServiceError(v.error.issues[0]?.message ?? "입력값 오류");
  const task = await loadTask(db, actor.termId, taskId);
  assertCan(actor, { type: "reference.add", task: taskResource(task) });
  if (task.status === "cancelled") throw new ServiceError("취소된 업무입니다.");
  if (!available) throw new ServiceError("AI 일시 사용 불가 — 링크·파일은 직접 추가할 수 있습니다.", 503);
  const running = await db.referenceRequest.count({ where: { task_id: task.id, status: { in: ["queued", "running"] } } });
  if (running) throw new ServiceError("이미 제작 중인 의뢰가 있습니다. 끝나면 알려 드립니다.");
  const meeting = v.data.useMinutes ? await meetingForTask(db, task) : null;
  const plan = v.data.usePlan && task.project_id ? await planForContext(db, task.project_id) : null;
  const past = v.data.usePastWork ? await pastWorkForTask(db, task) : [];
  return db.$transaction(async (tx) => {
    const req = await tx.referenceRequest.create({
      data: {
        task_id: task.id,
        requested_by: actor.userId,
        instruction: v.data.instruction,
        status: "queued",
        context_snapshot: {
          options: { useMinutes: v.data.useMinutes, usePlan: v.data.usePlan, usePastWork: v.data.usePastWork },
          meeting: meeting ? { meetingId: meeting.meetingId, title: meeting.title, analysisId: meeting.analysisId, analysisVersion: meeting.analysisVersion } : null,
          plan: plan ? { versionId: plan.versionId, versionNo: plan.versionNo, isDraft: plan.isDraft } : null,
          pastWork: past.map((p) => ({ versionId: p.versionId, title: `${p.taskTitle} — ${p.deliverableTitle}` })),
        },
      },
    });
    const job = await tx.aiJob.create({ data: { type: "reference", payload: { requestId: req.id, taskId: task.id }, idempotency_key: `reference:${req.id}` } });
    if (task.status === "todo") {
      await tx.task.update({ where: { id: task.id }, data: { status: "in_progress" } });
      await writeAudit(tx, { actorId: null, actorKind: "system", action: "task.auto_status", entityType: "task", entityId: task.id, diff: { before: "todo", after: "in_progress", reason: "레퍼런스 제작 의뢰" } });
    }
    await writeAudit(tx, { actorId: actor.userId, action: "reference.request", entityType: "task", entityId: task.id, diff: { requestId: req.id, options: v.data } });
    return { requestId: req.id, aiJobId: job.id };
  });
}

/** 레퍼런스 탭 데이터 — 모든 구성원 열람 */
export async function listReferences(db: Db, actor: ActorT, taskId: string, available = aiAvailable()) {
  const task = await loadTask(db, actor.termId, taskId);
  assertCan(actor, { type: "reference.view" });
  const [items, requests, meeting, plan] = await Promise.all([
    db.referenceItem.findMany({ where: { task_id: task.id, deleted_at: null }, orderBy: { created_at: "desc" }, include: { request: { select: { requested_by: true } } } }),
    db.referenceRequest.findMany({ where: { task_id: task.id }, orderBy: { created_at: "desc" }, take: 10 }),
    meetingForTask(db, task),
    task.project_id ? planForContext(db, task.project_id) : null,
  ]);
  const userIds = [...new Set([...items.map((i) => i.created_by), ...requests.map((r) => r.requested_by)].filter(Boolean) as string[])];
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, display_name: true } });
  const name = (id: string | null) => users.find((u) => u.id === id)?.display_name ?? null;
  const res = taskResource(task);
  return {
    canAdd: can(actor, { type: "reference.add", task: res }) && task.status !== "cancelled",
    aiAvailable: available,
    context: { meeting: meeting ? { title: meeting.title, analysisVersion: meeting.analysisVersion } : null, plan: plan ? { versionNo: plan.versionNo, isDraft: plan.isDraft } : null },
    requests: requests.map((r) => ({
      id: r.id,
      status: r.status as "queued" | "running" | "done" | "failed",
      instruction: r.instruction,
      by: name(r.requested_by),
      at: r.created_at,
      error: r.error,
      snapshot: r.context_snapshot as {
        meeting?: { title: string; analysisVersion: number } | null;
        plan?: { versionNo: number; isDraft: boolean } | null;
        pastWork?: { title: string }[];
        searchFailed?: boolean;
        searchNote?: string;
        model?: string;
      } | null,
    })),
    items: items.map((i) => ({
      id: i.id,
      kind: i.kind as "link" | "file" | "ai_example",
      origin: i.origin as "user" | "ai_search" | "ai_generated",
      title: i.title,
      url: i.url,
      summary: i.summary,
      relevance: i.relevance_note,
      points: (i.points as string[] | null) ?? [],
      content: i.content,
      format: i.content_format as "markdown" | "html" | "svg" | null,
      needsReview: i.needs_review_before_send,
      requestId: i.request_id,
      fileName: i.original_name,
      preview: i.storage_key ? previewKind(i.mime) : null,
      fileUrl: i.storage_key ? signedFileUrl(i.storage_key) : null,
      downloadUrl: i.storage_key ? signedFileUrl(i.storage_key, { download: true }) : null,
      by: name(i.created_by),
      at: i.created_at,
      canDelete: isLeader(actor) || (i.created_by ?? i.request?.requested_by) === actor.userId,
    })),
  };
}
