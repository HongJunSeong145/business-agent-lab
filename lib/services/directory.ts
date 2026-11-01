import { z } from "zod";
import type { Db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { assertCan, can, isLeader, type Actor } from "@/lib/auth/can";
import { writeAudit } from "@/lib/audit/log";
import { detectDeliverableKind, DELIVERABLE_MIME, isImageMime } from "@/lib/files/deliverable";
import { UploadRejectedError } from "@/lib/files/detect";
import { newStorageKey, type Storage } from "@/lib/storage";
import { ServiceError } from "./invitations";

/**
 * 메인 대시보드 편집 (8-2, T21·T22): 배너, 학생회 인적사항, 외부 연락망(가변 열).
 *  - 인적사항: 국원은 자기 행만, 회장·국장은 전체 편집·추가·삭제(T21)
 *  - 연락망: 행 편집은 전원, 열 추가·이름 변경·삭제·되돌리기는 회장·국장(T22)
 * 개인정보는 감사 로그에 값 대신 바뀐 필드 이름만 남긴다(10-4).
 */
type ActorT = Actor & { termId: string };
type Tx = Prisma.TransactionClient;

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw new ServiceError(r.error.issues[0]?.message ?? "입력값 오류");
  return r.data;
}
const opt = (max: number, msg?: string) => z.string().trim().max(max, msg).nullable().optional().transform((v) => (v ? v : null));

// ───────── 배너 ─────────
const bannerSchema = z.object({ title: opt(80, "제목은 80자 이하"), subtitle: opt(120, "부제는 120자 이하") });

export async function updateBanner(db: Db, storage: Storage, actor: ActorT, raw: unknown, image?: { name: string; bytes: Uint8Array } | null, removeImage = false) {
  assertCan(actor, { type: "settings.manage" });
  const v = parse(bannerSchema, raw);
  let key: string | null | undefined;
  if (image) {
    if (image.bytes.byteLength > 5 * 1024 * 1024) throw new ServiceError("배너 사진은 5MB 이하만 올릴 수 있습니다.");
    let kind;
    try {
      kind = detectDeliverableKind(image.name, image.bytes);
    } catch (e) {
      if (e instanceof UploadRejectedError) throw new ServiceError(e.message);
      throw e;
    }
    if (!isImageMime(DELIVERABLE_MIME[kind])) throw new ServiceError("배너는 PNG·JPG·GIF·WEBP 이미지만 올릴 수 있습니다.");
    key = newStorageKey("banner");
    await storage.put(key, image.bytes, DELIVERABLE_MIME[kind]);
  } else if (removeImage) key = null;
  const before = await db.term.findUniqueOrThrow({ where: { id: actor.termId } });
  await db.$transaction(async (tx) => {
    await tx.term.update({ where: { id: actor.termId }, data: { banner_title: v.title, banner_subtitle: v.subtitle, ...(key !== undefined ? { banner_image_key: key } : {}) } });
    await writeAudit(tx, { actorId: actor.userId, action: "settings.banner", entityType: "term", entityId: actor.termId, diff: { title: v.title, subtitle: v.subtitle, image: key === undefined ? "unchanged" : key ? "new" : "removed" } });
  });
  if (key !== undefined && before.banner_image_key) await storage.delete(before.banner_image_key).catch(() => undefined);
}

// ───────── 인적사항 ─────────
const profileSchema = z.object({
  position_title: opt(50),
  name: z.string().trim().min(1, "이름을 입력하세요.").max(50),
  major: opt(80),
  student_id: opt(20).refine((v) => !v || /^[0-9A-Za-z-]+$/.test(v), "학번 형식 오류"),
  phone: opt(30).refine((v) => !v || /^[0-9+\-() ]+$/.test(v), "연락처 형식 오류"),
  gmail: opt(120).refine((v) => !v || z.string().email().safeParse(v).success, "G-mail 형식 오류"),
  school_email: opt(120).refine((v) => !v || z.string().email().safeParse(v).success, "학교메일 형식 오류"),
});

async function loadProfile(db: Db | Tx, termId: string, id: string) {
  const p = await db.memberProfile.findFirst({ where: { id, term_id: termId, deleted_at: null } });
  if (!p) throw new ServiceError("인적사항을 찾을 수 없습니다.", 404);
  return p;
}

export async function listProfiles(db: Db, actor: ActorT) {
  assertCan(actor, { type: "profile.view" });
  const rows = await db.memberProfile.findMany({ where: { term_id: actor.termId, deleted_at: null }, orderBy: [{ display_order: "asc" }, { created_at: "asc" }] });
  return {
    canCreate: can(actor, { type: "profile.create" }),
    rows: rows.map((r) => ({ ...r, canEdit: can(actor, { type: "profile.edit", profile: { userId: r.user_id } }), canDelete: isLeader(actor) })),
  };
}

export async function createProfile(db: Db, actor: ActorT, raw: unknown) {
  assertCan(actor, { type: "profile.create" });
  const v = parse(profileSchema, raw);
  const max = await db.memberProfile.aggregate({ where: { term_id: actor.termId }, _max: { display_order: true } });
  return db.$transaction(async (tx) => {
    const p = await tx.memberProfile.create({ data: { ...v, term_id: actor.termId, display_order: (max._max.display_order ?? 0) + 1 } });
    await writeAudit(tx, { actorId: actor.userId, action: "profile.create", entityType: "member_profile", entityId: p.id, diff: { fields: Object.keys(v) } });
    return p;
  });
}

export async function updateProfile(db: Db, actor: ActorT, id: string, raw: unknown) {
  const p = await loadProfile(db, actor.termId, id);
  assertCan(actor, { type: "profile.edit", profile: { userId: p.user_id } });
  const v = parse(profileSchema.partial(), raw);
  const changed = Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== (p as Record<string, unknown>)[k]);
  return db.$transaction(async (tx) => {
    const r = await tx.memberProfile.update({ where: { id }, data: v });
    await writeAudit(tx, { actorId: actor.userId, action: "profile.update", entityType: "member_profile", entityId: id, diff: { fields: changed } });
    return r;
  });
}

export async function deleteProfile(db: Db, actor: ActorT, id: string) {
  assertCan(actor, { type: "profile.create" });
  await loadProfile(db, actor.termId, id);
  await db.$transaction(async (tx) => {
    await tx.memberProfile.update({ where: { id }, data: { deleted_at: new Date() } });
    await writeAudit(tx, { actorId: actor.userId, action: "profile.delete", entityType: "member_profile", entityId: id });
  });
}

// ───────── 외부 연락망 ─────────
const label = z.string().trim().min(1, "열 이름을 입력하세요.").max(30, "열 이름은 30자 이하");

export async function listContacts(db: Db, actor: ActorT) {
  const [columns, rows] = await Promise.all([
    db.contactColumn.findMany({ where: { term_id: actor.termId }, orderBy: [{ display_order: "asc" }, { created_at: "asc" }] }),
    db.contactRow.findMany({ where: { term_id: actor.termId, deleted_at: null }, orderBy: [{ display_order: "asc" }, { created_at: "asc" }] }),
  ]);
  return {
    columns: columns.filter((c) => !c.deleted_at).map((c) => ({ id: c.id, key: c.key, label: c.label })),
    deletedColumns: columns.filter((c) => c.deleted_at).map((c) => ({ id: c.id, key: c.key, label: c.label, deletedAt: c.deleted_at })),
    rows: rows.map((r) => ({ id: r.id, data: (r.data ?? {}) as Record<string, string>, is_demo: r.is_demo })),
    canEditRows: can(actor, { type: "contacts.editRows" }),
    canEditColumns: can(actor, { type: "contacts.editColumns" }),
  };
}

const rowSchema = z.record(z.string().max(60), z.string().trim().max(500, "칸 내용은 500자 이하"));

async function cleanRowData(db: Db | Tx, termId: string, raw: unknown) {
  const data = parse(rowSchema, raw ?? {});
  const keys = new Set((await db.contactColumn.findMany({ where: { term_id: termId }, select: { key: true } })).map((c) => c.key));
  return Object.fromEntries(Object.entries(data).filter(([k]) => keys.has(k)));
}

export async function createContactRow(db: Db, actor: ActorT, raw: unknown) {
  assertCan(actor, { type: "contacts.editRows" });
  const data = await cleanRowData(db, actor.termId, (raw as { data?: unknown } | null)?.data);
  const max = await db.contactRow.aggregate({ where: { term_id: actor.termId }, _max: { display_order: true } });
  return db.$transaction(async (tx) => {
    const r = await tx.contactRow.create({ data: { term_id: actor.termId, data, created_by: actor.userId, display_order: (max._max.display_order ?? 0) + 1 } });
    await writeAudit(tx, { actorId: actor.userId, action: "contact.create", entityType: "contact_row", entityId: r.id, diff: { fields: Object.keys(data) } });
    return r;
  });
}

export async function updateContactRow(db: Db, actor: ActorT, id: string, raw: unknown) {
  assertCan(actor, { type: "contacts.editRows" });
  const row = await db.contactRow.findFirst({ where: { id, term_id: actor.termId, deleted_at: null } });
  if (!row) throw new ServiceError("연락처를 찾을 수 없습니다.", 404);
  const patch = await cleanRowData(db, actor.termId, (raw as { data?: unknown } | null)?.data);
  const data = { ...((row.data ?? {}) as Record<string, string>), ...patch };
  return db.$transaction(async (tx) => {
    const r = await tx.contactRow.update({ where: { id }, data: { data } });
    await writeAudit(tx, { actorId: actor.userId, action: "contact.update", entityType: "contact_row", entityId: id, diff: { fields: Object.keys(patch) } });
    return r;
  });
}

export async function deleteContactRow(db: Db, actor: ActorT, id: string) {
  assertCan(actor, { type: "contacts.editRows" });
  const r = await db.contactRow.updateMany({ where: { id, term_id: actor.termId, deleted_at: null }, data: { deleted_at: new Date() } });
  if (!r.count) throw new ServiceError("연락처를 찾을 수 없습니다.", 404);
  await writeAudit(db, { actorId: actor.userId, action: "contact.delete", entityType: "contact_row", entityId: id });
}

export async function addContactColumn(db: Db, actor: ActorT, raw: unknown) {
  assertCan(actor, { type: "contacts.editColumns" });
  const name = parse(label, (raw as { label?: unknown } | null)?.label);
  const cols = await db.contactColumn.findMany({ where: { term_id: actor.termId } });
  if (cols.some((c) => !c.deleted_at && c.label === name)) throw new ServiceError("같은 이름의 열이 있습니다.");
  if (cols.filter((c) => !c.deleted_at).length >= 20) throw new ServiceError("열은 20개까지 만들 수 있습니다.");
  const key = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return db.$transaction(async (tx) => {
    const c = await tx.contactColumn.create({ data: { term_id: actor.termId, key, label: name, display_order: Math.max(0, ...cols.map((x) => x.display_order)) + 1 } });
    await writeAudit(tx, { actorId: actor.userId, action: "contact.column_add", entityType: "contact_column", entityId: c.id, diff: { label: name } });
    return c;
  });
}

async function loadColumn(db: Db | Tx, termId: string, id: string) {
  const c = await db.contactColumn.findFirst({ where: { id, term_id: termId } });
  if (!c) throw new ServiceError("열을 찾을 수 없습니다.", 404);
  return c;
}

export async function renameContactColumn(db: Db, actor: ActorT, id: string, raw: unknown) {
  assertCan(actor, { type: "contacts.editColumns" });
  const name = parse(label, (raw as { label?: unknown } | null)?.label);
  const c = await loadColumn(db, actor.termId, id);
  if (await db.contactColumn.count({ where: { term_id: actor.termId, deleted_at: null, label: name, id: { not: id } } })) throw new ServiceError("같은 이름의 열이 있습니다.");
  await db.$transaction(async (tx) => {
    await tx.contactColumn.update({ where: { id }, data: { label: name } });
    await writeAudit(tx, { actorId: actor.userId, action: "contact.column_rename", entityType: "contact_column", entityId: id, diff: { before: c.label, after: name } });
  });
}

/** 열 삭제는 숨김(값은 보존) → '되돌리기'로 복원 */
export async function setContactColumnDeleted(db: Db, actor: ActorT, id: string, deleted: boolean) {
  assertCan(actor, { type: "contacts.editColumns" });
  const c = await loadColumn(db, actor.termId, id);
  if (deleted && (await db.contactColumn.count({ where: { term_id: actor.termId, deleted_at: null } })) <= 1) throw new ServiceError("열은 최소 1개 있어야 합니다.");
  await db.$transaction(async (tx) => {
    await tx.contactColumn.update({ where: { id }, data: { deleted_at: deleted ? new Date() : null } });
    await writeAudit(tx, { actorId: actor.userId, action: deleted ? "contact.column_delete" : "contact.column_restore", entityType: "contact_column", entityId: id, diff: { label: c.label } });
  });
}
