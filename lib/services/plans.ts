import { z } from "zod";
import type { Db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { assertCan, can, isLeader, type Actor } from "@/lib/auth/can";
import { writeAudit } from "@/lib/audit/log";
import { detectMinutesKind, KIND_MIME, UploadRejectedError } from "@/lib/files/detect";
import { newStorageKey, type Storage } from "@/lib/storage";
import { signedFileUrl } from "@/lib/storage/signed-url";
import { dateColumnToString } from "@/lib/utils";
import { notifyLeaders } from "./notifications";
import { recomputeReadiness } from "./tasks";
import { recalcProjectSchedule } from "./schedule";
import { sanitizeFileName } from "./meetings";
import { ServiceError } from "./invitations";

/**
 * 기획안 모듈 (PART 4 기획안, D7, 8-5 기획안 탭).
 *  - 저장할 때마다 새 버전(양식 필드 + 선택 첨부파일). 첫 초안이 생기면 '기획안 초안 작성' 업무가 진행 중이 되어
 *    '초안 있으면 착수' 업무가 풀린다.
 *  - 결재(회장·국장): 현재 버전에 결재 기록 → '기획안 초안 작성'·'기획안 검토 및 결재' 표준 업무 완료
 *    → 결재 의존 업무(홍보물·집행 매뉴얼·제휴 요청서 등) 자동 todo 전환 + 담당자 알림.
 *  - 결재 후 새 버전을 저장하면 '수정 중'(결재본은 그대로 유지, 이미 풀린 업무를 다시 막지 않음).
 *    수정본이 다시 결재되면 의존 업무 담당자에게 "기획안 변경" 알림(D7).
 */
type ActorT = Actor & { termId: string };
type Tx = Prisma.TransactionClient;

export const PLAN_STATUS_LABEL: Record<string, string> = { draft: "작성 중", submitted: "결재 요청", approved: "결재 완료", rejected: "반려" };

const text = (max: number) => z.string().trim().max(max).default("");
export const planFieldsSchema = z.object({
  title: text(150),
  datetime: text(200),
  venue: text(200),
  budget: z.union([z.null(), z.coerce.number().int().min(0, "예산액은 0 이상").max(1_000_000_000)]).default(null),
  host: text(150),
  organizer: text(150),
  purpose: text(5000),
  content: text(20000),
  timetable: z.array(z.object({ time: text(50), item: text(300) })).max(60).default([]),
  budget_scenarios: z.array(z.object({ name: text(50), amount: z.coerce.number().int().min(0).max(1_000_000_000), note: text(300) })).max(5).default([]),
});
export type PlanFields = z.output<typeof planFieldsSchema>;

/** 결재에 필요한 필수 항목(6-3): 일시·장소·예산액·주최·주관·행사명·배경 및 목적·행사 내용 */
export function missingRequired(f: PlanFields): string[] {
  const miss: string[] = [];
  if (!f.title) miss.push("행사명");
  if (!f.datetime) miss.push("일시");
  if (!f.venue) miss.push("장소");
  if (f.budget === null) miss.push("예산액");
  if (!f.host) miss.push("주최");
  if (!f.organizer) miss.push("주관");
  if (!f.purpose) miss.push("배경 및 목적");
  if (!f.content) miss.push("행사 내용");
  return miss;
}

async function loadProject(db: Db | Tx, termId: string, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, term_id: termId, deleted_at: null }, include: { funding_sources: true } });
  if (!p) throw new ServiceError("사업을 찾을 수 없습니다.", 404);
  return p;
}

function canEdit(actor: Actor) {
  return isLeader(actor) || can(actor, { type: "plan.edit" });
}

/** 기획안 탭 데이터. 버전이 없으면 사업 정보로 채운 빈 양식을 준다. */
export async function getPlan(db: Db, actor: ActorT, projectId: string) {
  const p = await loadProject(db, actor.termId, projectId);
  const plan = await db.plan.findUnique({ where: { project_id: p.id }, include: { versions: { orderBy: { version_no: "desc" } } } });
  const users = await db.user.findMany({
    where: { id: { in: [...new Set((plan?.versions ?? []).flatMap((v) => [v.author_id, v.approved_by]).filter(Boolean) as string[])] } },
    select: { id: true, display_name: true },
  });
  const name = (id: string | null) => users.find((u) => u.id === id)?.display_name ?? null;
  const prefill: PlanFields = planFieldsSchema.parse({
    title: p.title,
    datetime: p.event_start ? `${dateColumnToString(p.event_start)}${p.event_end && +p.event_end !== +p.event_start ? ` ~ ${dateColumnToString(p.event_end)}` : ""}` : "",
    venue: p.venue ?? "",
    budget: p.funding_sources.length ? p.funding_sources.reduce((n, f) => n + Number(f.amount_planned), 0) : null,
    host: p.host ?? "",
    organizer: p.organizer ?? "",
  });
  const approved = plan?.versions.find((v) => v.approved_at);
  return {
    projectId: p.id,
    status: plan?.status ?? null,
    currentVersionId: plan?.current_version_id ?? null,
    approvedVersionId: approved?.id ?? null,
    versions: (plan?.versions ?? []).map((v) => ({
      id: v.id,
      versionNo: v.version_no,
      fields: planFieldsSchema.parse(v.fields),
      note: v.note,
      author: name(v.author_id),
      at: v.created_at,
      approvedBy: name(v.approved_by),
      approvedAt: v.approved_at,
      file: v.file_key ? { name: v.file_name ?? "첨부파일", url: signedFileUrl(v.file_key), downloadUrl: signedFileUrl(v.file_key, { download: true }) } : null,
    })),
    prefill,
    permissions: { edit: canEdit(actor) && p.status !== "cancelled", approve: can(actor, { type: "plan.approve" }) && p.status !== "cancelled" },
  };
}

/** 새 버전 저장 (양식 + 선택 첨부: PDF·DOCX·HWPX·HWP) */
export async function savePlanVersion(
  db: Db,
  storage: Storage,
  actor: ActorT,
  projectId: string,
  input: { fields: unknown; note?: string; file?: { name: string; bytes: Uint8Array } },
) {
  if (!canEdit(actor)) throw new ServiceError("기획안은 기획국과 회장·국장만 작성할 수 있습니다.", 403);
  const p = await loadProject(db, actor.termId, projectId);
  if (p.status === "cancelled") throw new ServiceError("취소된 사업입니다.");
  const parsed = planFieldsSchema.safeParse(input.fields ?? {});
  if (!parsed.success) throw new ServiceError(parsed.error.issues[0]?.message ?? "입력값 오류");
  const note = input.note?.trim().slice(0, 500) || null;

  let file: { key: string; name: string; mime: string } | null = null;
  if (input.file) {
    const name = sanitizeFileName(input.file.name);
    let kind;
    try {
      kind = detectMinutesKind(name, input.file.bytes);
    } catch (e) {
      if (e instanceof UploadRejectedError) throw new ServiceError(e.message);
      throw e;
    }
    if (kind === "txt" || kind === "md") throw new ServiceError("기획안 첨부는 PDF·DOCX·HWPX·HWP 파일만 받습니다. 내용은 양식에 입력하세요.");
    file = { key: newStorageKey("plans"), name, mime: KIND_MIME[kind] };
    await storage.put(file.key, input.file.bytes, file.mime);
  }

  try {
    return await db.$transaction(async (tx) => {
      const plan = await tx.plan.upsert({ where: { project_id: p.id }, update: {}, create: { project_id: p.id, status: "draft" } });
      await tx.$queryRaw`SELECT id FROM plans WHERE id = ${plan.id}::uuid FOR UPDATE`;
      const last = await tx.planVersion.aggregate({ where: { plan_id: plan.id }, _max: { version_no: true } });
      const v = await tx.planVersion.create({
        data: {
          plan_id: plan.id,
          version_no: (last._max.version_no ?? 0) + 1,
          fields: parsed.data as object,
          note,
          file_key: file?.key ?? null,
          file_name: file?.name ?? null,
          file_mime: file?.mime ?? null,
          author_id: actor.userId,
        },
      });
      await tx.plan.update({ where: { id: plan.id }, data: { current_version_id: v.id, status: "draft" } });
      // 초안이 생겼으므로 '기획안 초안 작성' 업무를 진행 중으로 → '초안 있으면 착수' 업무가 풀린다
      // (선행 대기 중이어도 실제 초안이 저장됐으면 작성이 시작된 것)
      const drafts = await tx.task.findMany({ where: { project_id: p.id, template_key: "PLN_DRAFT", deleted_at: null, status: { in: ["todo", "blocked"] } }, select: { id: true, status: true } });
      for (const d of drafts) {
        await tx.task.update({ where: { id: d.id }, data: { status: "in_progress" } });
        await writeAudit(tx, { actorId: null, actorKind: "system", action: "task.auto_status", entityType: "task", entityId: d.id, diff: { before: d.status, after: "in_progress", reason: `기획안 v${v.version_no} 작성` } });
      }
      // 기획안 업무(초안·결재)에 기대는 업무를 다시 계산: 초안 있으면 착수 / 초안 기반 선착수 허용 업무
      const planTasks = await tx.task.findMany({ where: { project_id: p.id, template_key: { in: ["PLN_DRAFT", "PLN_APPROVAL"] }, deleted_at: null }, select: { id: true } });
      if (planTasks.length) await recomputeReadiness(tx, actor.termId, { dependentsOf: planTasks.map((d) => d.id) });
      await writeAudit(tx, { actorId: actor.userId, action: "plan.save", entityType: "project", entityId: p.id, diff: { version: v.version_no, file: file?.name ?? null } });
      return { planId: plan.id, versionId: v.id, versionNo: v.version_no, missing: missingRequired(parsed.data) };
    });
  } catch (e) {
    if (file) await storage.delete(file.key).catch(() => undefined);
    throw e;
  }
}

async function loadPlan(db: Db | Tx, termId: string, projectId: string) {
  const p = await loadProject(db, termId, projectId);
  const plan = await db.plan.findUnique({ where: { project_id: p.id }, include: { versions: { orderBy: { version_no: "desc" } } } });
  const current = plan?.versions.find((v) => v.id === plan.current_version_id);
  if (!plan || !current) throw new ServiceError("기획안을 먼저 작성하세요.");
  return { project: p, plan, current };
}

/** 결재 요청 → 회장·국장 알림 */
export async function submitPlan(db: Db, actor: ActorT, projectId: string) {
  if (!canEdit(actor)) throw new ServiceError("기획안은 기획국과 회장·국장만 결재 요청할 수 있습니다.", 403);
  const { project, plan, current } = await loadPlan(db, actor.termId, projectId);
  if (plan.status === "approved") throw new ServiceError("이미 결재된 버전입니다.");
  const missing = missingRequired(planFieldsSchema.parse(current.fields));
  if (missing.length) throw new ServiceError(`필수 항목을 채워 주세요: ${missing.join(", ")}`);
  await db.$transaction(async (tx) => {
    await tx.plan.update({ where: { id: plan.id }, data: { status: "submitted" } });
    await writeAudit(tx, { actorId: actor.userId, action: "plan.submit", entityType: "project", entityId: project.id, diff: { version: current.version_no } });
    await notifyLeaders(tx, actor.termId, { type: "plan_submitted", title: `기획안 결재 요청: ${project.title} v${current.version_no}`, link: `/projects/${project.id}#plan`, dedupeKey: `plan-submit:${current.id}` });
  });
}

/**
 * 결재 (회장·국장). 현재 버전을 결재본으로 확정하고 D7 연동을 한 트랜잭션으로 처리한다.
 */
export async function approvePlan(db: Db, actor: ActorT, projectId: string) {
  assertCan(actor, { type: "plan.approve" });
  return db.$transaction(async (tx) => {
    const { project, plan, current } = await loadPlan(tx, actor.termId, projectId);
    if (current.approved_at) throw new ServiceError("이미 결재된 버전입니다.");
    const missing = missingRequired(planFieldsSchema.parse(current.fields));
    if (missing.length) throw new ServiceError(`필수 항목이 비어 있어 결재할 수 없습니다: ${missing.join(", ")}`);
    const previouslyApproved = plan.versions.find((v) => v.approved_at);
    const now = new Date();
    await tx.planVersion.update({ where: { id: current.id }, data: { approved_by: actor.userId, approved_at: now } });
    await tx.plan.update({ where: { id: plan.id }, data: { status: "approved" } });

    // 표준 업무 완료: 초안 작성·검토 및 결재
    const planTasks = await tx.task.findMany({
      where: { project_id: project.id, template_key: { in: ["PLN_DRAFT", "PLN_APPROVAL"] }, deleted_at: null, is_completed: false, status: { not: "cancelled" } },
    });
    for (const t of planTasks) {
      await tx.task.update({ where: { id: t.id }, data: { is_completed: true, completed_by: actor.userId, completed_at: now, status: "done" } });
      await tx.progressHistory.create({
        data: { task_id: t.id, field: "completed", old_value: "false", new_value: "true", actor: "user", actor_user_id: actor.userId, reason: `${t.ai_progress !== null ? `AI 평가 ${t.ai_progress}% / ` : ""}기획안 v${current.version_no} 결재로 완료` },
      });
      await writeAudit(tx, { actorId: actor.userId, action: "task.complete", entityType: "task", entityId: t.id, diff: { reason: "plan.approve", version: current.version_no } });
    }
    const approvalIds = (await tx.task.findMany({ where: { project_id: project.id, template_key: { in: ["PLN_DRAFT", "PLN_APPROVAL"] }, deleted_at: null }, select: { id: true } })).map((t) => t.id);
    const before = await tx.task.findMany({ where: { project_id: project.id, deleted_at: null }, select: { id: true, status: true } });
    await recomputeReadiness(tx, actor.termId, { dependentsOf: approvalIds });
    if (planTasks.length) await recalcProjectSchedule(tx, actor.termId, project.id, "proposed");
    const after = await tx.task.findMany({
      where: { project_id: project.id, deleted_at: null },
      select: { id: true, title: true, status: true, started_on_draft_plan: true, assignees: { select: { user_id: true } }, dependencies: { select: { depends_on_task_id: true } } },
    });
    const unblocked = after.filter((t) => before.find((b) => b.id === t.id)?.status === "blocked" && t.status === "todo");
    const dependents = after.filter((t) => t.dependencies.some((d) => approvalIds.includes(d.depends_on_task_id)) && t.status !== "cancelled" && t.status !== "done");

    const notes: { user_id: string; type: string; title: string; body: string; link: string; dedupe_key: string }[] = [];
    for (const t of dependents) {
      const reason = unblocked.includes(t)
        ? "기획안이 결재되어 착수할 수 있습니다."
        : previouslyApproved
          ? `기획안이 v${previouslyApproved.version_no} → v${current.version_no}로 변경 결재되었습니다. 변경점을 확인하세요.`
          : t.started_on_draft_plan
            ? "초안 기준으로 먼저 착수한 업무입니다. 결재본과 달라진 점이 있는지 확인하세요."
            : null;
      if (!reason) continue;
      for (const a of t.assignees) notes.push({ user_id: a.user_id, type: "plan_approved", title: `${t.title}: ${reason}`, body: `${project.title} 기획안 v${current.version_no}`, link: `/projects/${project.id}?task=${t.id}`, dedupe_key: `plan-approved:${current.id}:${t.id}` });
    }
    if (notes.length) await tx.notification.createMany({ data: notes, skipDuplicates: true });
    const author = current.author_id !== actor.userId ? current.author_id : null;
    if (author) await tx.notification.create({ data: { user_id: author, type: "plan_approved", title: `기획안 결재 완료: ${project.title} v${current.version_no}`, link: `/projects/${project.id}#plan`, dedupe_key: `plan-approved-author:${current.id}` } });
    await writeAudit(tx, { actorId: actor.userId, action: "plan.approve", entityType: "project", entityId: project.id, diff: { version: current.version_no, unblocked: unblocked.map((t) => t.id), completed: planTasks.map((t) => t.id) } });
    return { versionNo: current.version_no, unblocked: unblocked.map((t) => ({ id: t.id, title: t.title })), completed: planTasks.map((t) => t.id) };
  });
}

/** 반려 (사유 필수) → 작성자 알림 */
export async function rejectPlan(db: Db, actor: ActorT, projectId: string, reasonRaw: unknown) {
  assertCan(actor, { type: "plan.approve" });
  const reason = typeof reasonRaw === "string" ? reasonRaw.trim().slice(0, 500) : "";
  if (!reason) throw new ServiceError("반려 사유를 입력하세요.");
  const { project, plan, current } = await loadPlan(db, actor.termId, projectId);
  if (current.approved_at) throw new ServiceError("이미 결재된 버전입니다.");
  await db.$transaction(async (tx) => {
    await tx.plan.update({ where: { id: plan.id }, data: { status: "rejected" } });
    await writeAudit(tx, { actorId: actor.userId, action: "plan.reject", entityType: "project", entityId: project.id, diff: { version: current.version_no, reason } });
    await tx.notification.create({
      data: { user_id: current.author_id, type: "plan_rejected", title: `기획안 반려: ${project.title} v${current.version_no}`, body: reason, link: `/projects/${project.id}#plan`, severity: "warn", dedupe_key: `plan-reject:${current.id}` },
    });
  });
}

/** A5·A6 입력용: 결재본 우선, 없으면 최신 초안 */
export async function planForContext(db: Db | Tx, projectId: string) {
  const plan = await db.plan.findUnique({ where: { project_id: projectId }, include: { versions: { orderBy: { version_no: "desc" } } } });
  if (!plan || plan.versions.length === 0) return null;
  const approved = plan.versions.find((v) => v.approved_at);
  const v = approved ?? plan.versions[0]!;
  return { versionId: v.id, versionNo: v.version_no, isDraft: !approved, fields: planFieldsSchema.parse(v.fields) };
}

export function planToText(f: PlanFields): string {
  return [
    `행사명: ${f.title}`, `일시: ${f.datetime}`, `장소: ${f.venue}`, `예산액: ${f.budget === null ? "" : `${f.budget.toLocaleString()}원`}`,
    `주최: ${f.host}`, `주관: ${f.organizer}`, `배경 및 목적: ${f.purpose}`, `행사 내용: ${f.content}`,
    f.timetable.length ? `타임테이블:\n${f.timetable.map((t) => `- ${t.time} ${t.item}`).join("\n")}` : "",
    f.budget_scenarios.length ? `예산 시나리오:\n${f.budget_scenarios.map((b) => `- ${b.name}: ${b.amount.toLocaleString()}원 ${b.note}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}
