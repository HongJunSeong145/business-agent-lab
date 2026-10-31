import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { assertCan, can, isLeader, type Actor } from "@/lib/auth/can";
import { writeAudit } from "@/lib/audit/log";
import { UploadRejectedError } from "@/lib/files/detect";
import { DELIVERABLE_MIME, detectDeliverableKind, previewKind } from "@/lib/files/deliverable";
import { newStorageKey, type Storage } from "@/lib/storage";
import { signedFileUrl } from "@/lib/storage/signed-url";
import { loadRuleParams } from "@/lib/rule-params";
import { getNumberSetting } from "@/lib/settings";
import { dateColumnToString } from "@/lib/utils";
import { schoolTax, rosterRequired } from "@kgb/rules";
import { ServiceError } from "./invitations";

/**
 * 재정 모듈 (PART 4 재정, 5-5·5-6, 8-8): 분기 예결산(예산 라인·교비 세금), 구입 리스트, 증빙 업로드·검수, CSV.
 *  - 편집: 재정국 + 회장·국장 (`finance.edit`) / 증빙 업로드: 전원 (`evidence.upload`) / 검수: 재정국 + 회장·국장
 *  - 교비 라인 세금 = 계획액 × SCHOOL_TAX_RATE (T9: 1,000,000 → 100,000, 총액 1,100,000)
 */
type ActorT = Actor & { termId: string };

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw new ServiceError(r.error.issues[0]?.message ?? "입력값 오류");
  return r.data;
}
const money = z.coerce.number().int("금액은 원 단위 정수").min(0, "금액은 0 이상").max(1_000_000_000_000);
const source = z.enum(["school", "student_fee"]).nullable().optional();
export const EVIDENCE_LABEL: Record<string, string> = {
  receipt: "영수증", photo: "행사 사진", beneficiary_roster: "수혜자 명단", official_letter: "공문", plan_doc: "기획안", quote: "견적서", transfer_record: "이체내역", other: "기타",
};
export const PURCHASE_STATUS_LABEL: Record<string, string> = { listed: "목록", approved: "승인", purchased: "구입 완료", cancelled: "취소" };

async function project(db: Db, termId: string, id: string) {
  const p = await db.project.findFirst({ where: { id, term_id: termId, deleted_at: null } });
  if (!p) throw new ServiceError("사업을 찾을 수 없습니다.", 404);
  return p;
}

// ───────── 분기 예결산 ─────────
export async function ensurePeriods(db: Db, termId: string) {
  for (const q of [1, 2, 3, 4]) {
    const exists = await db.budgetPeriod.findFirst({ where: { term_id: termId, quarter: q } });
    if (!exists) await db.budgetPeriod.create({ data: { term_id: termId, quarter: q, review_group: q <= 2 ? "A" : "B" } });
  }
  return db.budgetPeriod.findMany({ where: { term_id: termId }, orderBy: { quarter: "asc" } });
}

export async function getQuarter(db: Db, actor: ActorT, quarter: number) {
  if (![1, 2, 3, 4].includes(quarter)) throw new ServiceError("분기는 1~4", 400);
  const periods = await ensurePeriods(db, actor.termId);
  const period = periods.find((p) => p.quarter === quarter)!;
  const lines = await db.budgetLine.findMany({ where: { budget_period_id: period.id }, include: { project: { select: { id: true, title: true } } }, orderBy: [{ project_id: "asc" }, { created_at: "asc" }] });
  const projects = await db.project.findMany({ where: { term_id: actor.termId, deleted_at: null, quarter }, select: { id: true, title: true, status: true }, orderBy: { event_start: "asc" } });
  const rows = lines.map((l) => ({
    id: l.id, project: l.project, funding_source: l.funding_source, category: l.category, item: l.item,
    planned: Number(l.planned_amount), actual: l.actual_amount === null ? null : Number(l.actual_amount), tax: Number(l.tax_amount),
  }));
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);
  return {
    period: { id: period.id, quarter, reviewGroup: period.review_group, reviewLabel: period.review_group === "A" ? "1·2분기 심사" : "3·4분기 심사", budgetStatus: period.budget_status, settlementStatus: period.settlement_status },
    lines: rows,
    totals: { planned: sum((r) => r.planned), tax: sum((r) => r.tax), plannedWithTax: sum((r) => r.planned + r.tax), actual: sum((r) => r.actual ?? 0) },
    projects,
    canEdit: can(actor, { type: "finance.edit" }),
  };
}

const lineSchema = z.object({
  project_id: z.string().uuid().nullable().optional(),
  funding_source: source,
  category: z.string().trim().max(50).nullable().optional(),
  item: z.string().trim().min(1, "항목을 입력하세요.").max(150),
  planned_amount: money,
  actual_amount: money.nullable().optional(),
});

async function taxFor(db: Db, termId: string, src: string | null | undefined, planned: number) {
  if (src !== "school") return 0;
  return schoolTax(planned, (await loadRuleParams(db, termId)).SCHOOL_TAX_RATE);
}

export async function addBudgetLine(db: Db, actor: ActorT, quarter: number, raw: unknown) {
  assertCan(actor, { type: "finance.edit" });
  const v = parse(lineSchema, raw);
  const periods = await ensurePeriods(db, actor.termId);
  const period = periods.find((p) => p.quarter === quarter);
  if (!period) throw new ServiceError("분기는 1~4", 400);
  if (v.project_id) await project(db, actor.termId, v.project_id);
  const tax = await taxFor(db, actor.termId, v.funding_source, v.planned_amount);
  return db.$transaction(async (tx) => {
    const l = await tx.budgetLine.create({
      data: { budget_period_id: period.id, project_id: v.project_id ?? null, funding_source: v.funding_source ?? null, category: v.category ?? null, item: v.item, planned_amount: BigInt(v.planned_amount), actual_amount: v.actual_amount == null ? null : BigInt(v.actual_amount), tax_amount: BigInt(tax) },
    });
    await writeAudit(tx, { actorId: actor.userId, action: "finance.line_add", entityType: "budget_line", entityId: l.id, diff: { quarter, item: v.item, planned: v.planned_amount, tax } });
    return l;
  });
}

export async function updateBudgetLine(db: Db, actor: ActorT, id: string, raw: unknown) {
  assertCan(actor, { type: "finance.edit" });
  const l = await db.budgetLine.findFirst({ where: { id, budget_period: { term_id: actor.termId } } });
  if (!l) throw new ServiceError("예산 라인을 찾을 수 없습니다.", 404);
  const v = parse(lineSchema.partial(), raw);
  const src = v.funding_source !== undefined ? v.funding_source : l.funding_source;
  const planned = v.planned_amount ?? Number(l.planned_amount);
  const tax = await taxFor(db, actor.termId, src, planned);
  return db.$transaction(async (tx) => {
    const r = await tx.budgetLine.update({
      where: { id },
      data: {
        ...(v.project_id !== undefined ? { project_id: v.project_id } : {}),
        ...(v.funding_source !== undefined ? { funding_source: v.funding_source } : {}),
        ...(v.category !== undefined ? { category: v.category } : {}),
        ...(v.item !== undefined ? { item: v.item } : {}),
        planned_amount: BigInt(planned),
        ...(v.actual_amount !== undefined ? { actual_amount: v.actual_amount === null ? null : BigInt(v.actual_amount) } : {}),
        tax_amount: BigInt(tax),
      },
    });
    await writeAudit(tx, { actorId: actor.userId, action: "finance.line_update", entityType: "budget_line", entityId: id, diff: { fields: Object.keys(v), tax } });
    return r;
  });
}

export async function deleteBudgetLine(db: Db, actor: ActorT, id: string) {
  assertCan(actor, { type: "finance.edit" });
  const r = await db.budgetLine.deleteMany({ where: { id, budget_period: { term_id: actor.termId } } });
  if (!r.count) throw new ServiceError("예산 라인을 찾을 수 없습니다.", 404);
  await writeAudit(db, { actorId: actor.userId, action: "finance.line_delete", entityType: "budget_line", entityId: id });
}

/** 예산안·결산안 상태: draft → submitted → approved */
export async function setPeriodStatus(db: Db, actor: ActorT, quarter: number, raw: unknown) {
  assertCan(actor, { type: "finance.edit" });
  const v = parse(z.object({ kind: z.enum(["budget", "settlement"]), status: z.enum(["draft", "submitted", "approved"]) }), raw);
  const p = (await ensurePeriods(db, actor.termId)).find((x) => x.quarter === quarter);
  if (!p) throw new ServiceError("분기는 1~4", 400);
  await db.budgetPeriod.update({ where: { id: p.id }, data: v.kind === "budget" ? { budget_status: v.status } : { settlement_status: v.status } });
  await writeAudit(db, { actorId: actor.userId, action: "finance.period_status", entityType: "budget_period", entityId: p.id, diff: v });
}

/** CSV(엑셀에서 한글이 깨지지 않도록 BOM) */
export async function quarterCsv(db: Db, actor: ActorT, quarter: number): Promise<string> {
  const q = await getQuarter(db, actor, quarter);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // 수식 주입 방지
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ["분기", "사업", "재원", "분류", "항목", "계획액", "세금(교비)", "계획 총액", "실제 집행액"];
  const body = q.lines.map((l) => [quarter, l.project?.title ?? "", l.funding_source === "school" ? "교비" : l.funding_source === "student_fee" ? "학생회비" : "", l.category ?? "", l.item, l.planned, l.tax, l.planned + l.tax, l.actual ?? ""]);
  body.push([quarter, "합계", "", "", "", q.totals.planned, q.totals.tax, q.totals.plannedWithTax, q.totals.actual]);
  return `﻿${[head, ...body].map((r) => r.map(esc).join(",")).join("\r\n")}\r\n`;
}

// ───────── 구입 리스트 ─────────
const purchaseSchema = z.object({
  name: z.string().trim().min(1, "품목을 입력하세요.").max(150),
  qty: z.coerce.number().int().min(1, "수량은 1 이상").max(100000),
  unit_price: money,
  vendor: z.string().trim().max(100).nullable().optional(),
  funding_source: source,
});

export async function addPurchase(db: Db, actor: ActorT, projectId: string, raw: unknown) {
  assertCan(actor, { type: "finance.edit" });
  const p = await project(db, actor.termId, projectId);
  const v = parse(purchaseSchema, raw);
  return db.$transaction(async (tx) => {
    const it = await tx.purchaseItem.create({ data: { project_id: p.id, name: v.name, qty: v.qty, unit_price: BigInt(v.unit_price), vendor: v.vendor ?? null, funding_source: v.funding_source ?? null } });
    await writeAudit(tx, { actorId: actor.userId, action: "finance.purchase_add", entityType: "project", entityId: p.id, diff: { item: v.name, qty: v.qty, unit_price: v.unit_price } });
    return it;
  });
}

export async function setPurchaseStatus(db: Db, actor: ActorT, id: string, raw: unknown) {
  assertCan(actor, { type: "finance.edit" });
  const { status } = parse(z.object({ status: z.enum(["listed", "approved", "purchased", "cancelled"]) }), raw);
  const it = await db.purchaseItem.findFirst({ where: { id, project: { term_id: actor.termId } } });
  if (!it) throw new ServiceError("구입 항목을 찾을 수 없습니다.", 404);
  await db.$transaction(async (tx) => {
    await tx.purchaseItem.update({ where: { id }, data: { status, ...(status === "purchased" ? { purchased_at: it.purchased_at ?? new Date(), purchased_by: it.purchased_by ?? actor.userId } : status === "listed" || status === "approved" ? { purchased_at: null, purchased_by: null } : {}) } });
    await writeAudit(tx, { actorId: actor.userId, action: "finance.purchase_status", entityType: "project", entityId: it.project_id, diff: { item: it.name, before: it.status, after: status } });
  });
}

// ───────── 증빙 ─────────
export async function uploadEvidence(
  db: Db,
  storage: Storage,
  actor: ActorT,
  projectId: string,
  input: { requirementId?: string | null; purchaseItemId?: string | null; note?: string | null; file: { name: string; bytes: Uint8Array } },
) {
  assertCan(actor, { type: "evidence.upload" });
  const p = await project(db, actor.termId, projectId);
  if (input.requirementId && !(await db.evidenceRequirement.count({ where: { id: input.requirementId, project_id: p.id } }))) throw new ServiceError("증빙 항목을 찾을 수 없습니다.", 404);
  if (input.purchaseItemId && !(await db.purchaseItem.count({ where: { id: input.purchaseItemId, project_id: p.id } }))) throw new ServiceError("구입 항목을 찾을 수 없습니다.", 404);
  if (!input.requirementId && !input.purchaseItemId) throw new ServiceError("어떤 증빙인지 고르세요.");
  const maxMb = await getNumberSetting(db, actor.termId, "UPLOAD_MAX_MB", Number(process.env.UPLOAD_MAX_MB ?? 50));
  if (input.file.bytes.byteLength > maxMb * 1024 * 1024) throw new ServiceError(`파일이 너무 큽니다(최대 ${maxMb}MB).`);
  let kind;
  try {
    kind = detectDeliverableKind(input.file.name, input.file.bytes);
  } catch (e) {
    if (e instanceof UploadRejectedError) throw new ServiceError(e.message);
    throw e;
  }
  // 구입 항목의 증빙은 영수증 요구 항목에 함께 연결(누락 탐지 기준)
  let requirementId = input.requirementId ?? null;
  if (!requirementId && input.purchaseItemId) {
    requirementId = (await db.evidenceRequirement.findFirst({ where: { project_id: p.id, type: { in: ["receipt", "transfer_record"] } } }))?.id ?? null;
  }
  const key = newStorageKey("evidence");
  const mime = DELIVERABLE_MIME[kind];
  await storage.put(key, input.file.bytes, mime);
  try {
    return await db.$transaction(async (tx) => {
      const e = await tx.evidenceItem.create({
        data: { project_id: p.id, requirement_id: requirementId, purchase_item_id: input.purchaseItemId ?? null, storage_key: key, original_name: input.file.name.split(/[\\/]/).pop()!.slice(-200), mime, uploaded_by: actor.userId, note: input.note?.trim().slice(0, 500) || null },
      });
      await writeAudit(tx, { actorId: actor.userId, action: "evidence.upload", entityType: "project", entityId: p.id, diff: { evidenceId: e.id, kind, sha256: createHash("sha256").update(input.file.bytes).digest("hex") } });
      return e;
    });
  } catch (e) {
    await storage.delete(key).catch(() => undefined);
    throw e;
  }
}

export async function verifyEvidence(db: Db, actor: ActorT, id: string, verified: boolean) {
  assertCan(actor, { type: "finance.edit" });
  const e = await db.evidenceItem.findFirst({ where: { id, deleted_at: null, project: { term_id: actor.termId } } });
  if (!e) throw new ServiceError("증빙을 찾을 수 없습니다.", 404);
  await db.$transaction(async (tx) => {
    await tx.evidenceItem.update({ where: { id }, data: verified ? { verified_by: actor.userId, verified_at: new Date() } : { verified_by: null, verified_at: null } });
    await writeAudit(tx, { actorId: actor.userId, action: verified ? "evidence.verify" : "evidence.unverify", entityType: "project", entityId: e.project_id, diff: { evidenceId: id } });
  });
}

export async function deleteEvidence(db: Db, actor: ActorT, id: string) {
  const e = await db.evidenceItem.findFirst({ where: { id, deleted_at: null, project: { term_id: actor.termId } } });
  if (!e) throw new ServiceError("증빙을 찾을 수 없습니다.", 404);
  if (e.verified_at && !can(actor, { type: "finance.edit" })) throw new ServiceError("검수된 증빙은 재정국만 삭제할 수 있습니다.", 403);
  if (!can(actor, { type: "finance.edit" }) && e.uploaded_by !== actor.userId) throw new ServiceError("올린 사람이나 재정국만 삭제할 수 있습니다.", 403);
  await db.$transaction(async (tx) => {
    await tx.evidenceItem.update({ where: { id }, data: { deleted_at: new Date() } });
    await writeAudit(tx, { actorId: actor.userId, action: "evidence.delete", entityType: "project", entityId: e.project_id, diff: { evidenceId: id } });
  });
}

/** 사업 재정 탭: 구입 리스트 + 증빙 체크리스트(충족/누락) */
export async function projectFinance(db: Db, actor: ActorT, projectId: string) {
  const p = await project(db, actor.termId, projectId);
  const params = await loadRuleParams(db, actor.termId);
  const [reqs, purchases, items, funding] = await Promise.all([
    db.evidenceRequirement.findMany({ where: { project_id: p.id }, orderBy: { created_at: "asc" } }),
    db.purchaseItem.findMany({ where: { project_id: p.id }, orderBy: { created_at: "asc" } }),
    db.evidenceItem.findMany({ where: { project_id: p.id, deleted_at: null }, orderBy: { created_at: "asc" } }),
    db.projectFundingSource.findMany({ where: { project_id: p.id } }),
  ]);
  const users = await db.user.findMany({ where: { id: { in: [...new Set(items.flatMap((i) => [i.uploaded_by, i.verified_by]).filter(Boolean) as string[])] } }, select: { id: true, display_name: true } });
  const name = (id: string | null) => users.find((u) => u.id === id)?.display_name ?? null;
  const view = (i: (typeof items)[number]) => ({
    id: i.id, name: i.original_name ?? "증빙", note: i.note, by: name(i.uploaded_by), at: i.created_at, verified: !!i.verified_at, verifiedBy: name(i.verified_by),
    preview: previewKind(i.mime), url: signedFileUrl(i.storage_key), downloadUrl: signedFileUrl(i.storage_key, { download: true }),
    canDelete: can(actor, { type: "finance.edit" }) || (!i.verified_at && i.uploaded_by === actor.userId),
  });
  const studentFee = funding.some((f) => f.source === "student_fee");
  return {
    canEdit: can(actor, { type: "finance.edit" }) && p.status !== "cancelled",
    canUpload: can(actor, { type: "evidence.upload" }),
    studentFee,
    rosterRequired: studentFee && rosterRequired(p.expected_beneficiaries, params.ROSTER_THRESHOLD),
    requirements: reqs.map((r) => {
      const mine = items.filter((i) => i.requirement_id === r.id && !i.purchase_item_id);
      return { id: r.id, type: r.type, label: EVIDENCE_LABEL[r.type] ?? r.type, required: r.required, due: r.due_date ? dateColumnToString(r.due_date) : null, met: items.some((i) => i.requirement_id === r.id), items: mine.map(view) };
    }),
    purchases: purchases.map((pi) => {
      const ev = items.filter((i) => i.purchase_item_id === pi.id);
      return {
        id: pi.id, name: pi.name, qty: pi.qty, unitPrice: Number(pi.unit_price), amount: pi.qty * Number(pi.unit_price), vendor: pi.vendor, funding: pi.funding_source, status: pi.status,
        purchasedAt: pi.purchased_at, receiptMissing: pi.status === "purchased" && studentFee && ev.length === 0, evidence: ev.map(view),
      };
    }),
    leader: isLeader(actor),
  };
}
