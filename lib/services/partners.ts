import { z } from "zod";
import type { Db } from "@/lib/db";
import { assertCan, can, type Actor } from "@/lib/auth/can";
import { writeAudit } from "@/lib/audit/log";
import { ServiceError } from "./invitations";

/** 제휴 후보 진행표 (8-5 제휴 탭, 6-3 사무국): 사무국 + 회장·국장 편집, 전원 열람 */
type ActorT = Actor & { termId: string };
export const PARTNER_STATUS = ["candidate", "contacted", "replied", "negotiating", "confirmed", "declined"] as const;
export const PARTNER_STATUS_LABEL: Record<string, string> = { candidate: "후보", contacted: "문의함", replied: "회신", negotiating: "협의 중", confirmed: "확정", declined: "거절" };

const schema = z.object({
  company_name: z.string().trim().min(1, "업체명을 입력하세요.").max(100),
  website: z.string().trim().max(500).nullable().optional().transform((v) => v || null).refine((v) => !v || /^https?:\/\//i.test(v), "웹사이트는 http(s):// 로 시작"),
  contact_channel: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
  note: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
  status: z.enum(PARTNER_STATUS).optional(),
  contact_row_id: z.string().uuid().nullable().optional(),
});

async function loadProject(db: Db, termId: string, id: string) {
  const p = await db.project.findFirst({ where: { id, term_id: termId, deleted_at: null } });
  if (!p) throw new ServiceError("사업을 찾을 수 없습니다.", 404);
  return p;
}

export async function listPartners(db: Db, actor: ActorT, projectId: string) {
  const p = await loadProject(db, actor.termId, projectId);
  const rows = await db.partnerLead.findMany({ where: { project_id: p.id }, orderBy: { created_at: "asc" } });
  return { canEdit: can(actor, { type: "partner.edit" }) && p.status !== "cancelled", rows };
}

export async function addPartner(db: Db, actor: ActorT, projectId: string, raw: unknown) {
  assertCan(actor, { type: "partner.edit" });
  const p = await loadProject(db, actor.termId, projectId);
  const r = schema.safeParse(raw);
  if (!r.success) throw new ServiceError(r.error.issues[0]?.message ?? "입력값 오류");
  const v = r.data;
  if (v.contact_row_id && !(await db.contactRow.count({ where: { id: v.contact_row_id, term_id: actor.termId } }))) throw new ServiceError("연락처를 찾을 수 없습니다.", 404);
  const row = await db.partnerLead.create({ data: { project_id: p.id, company_name: v.company_name, website: v.website, contact_channel: v.contact_channel, note: v.note, status: v.status ?? "candidate", contact_row_id: v.contact_row_id ?? null } });
  await writeAudit(db, { actorId: actor.userId, action: "partner.add", entityType: "project", entityId: p.id, diff: { company: v.company_name } });
  return row;
}

export async function updatePartner(db: Db, actor: ActorT, id: string, raw: unknown) {
  assertCan(actor, { type: "partner.edit" });
  const lead = await db.partnerLead.findFirst({ where: { id, project: { term_id: actor.termId } } });
  if (!lead) throw new ServiceError("제휴 후보를 찾을 수 없습니다.", 404);
  const r = schema.partial().safeParse(raw);
  if (!r.success) throw new ServiceError(r.error.issues[0]?.message ?? "입력값 오류");
  const v = r.data;
  const contacted = v.status && v.status !== lead.status && ["contacted", "replied", "negotiating"].includes(v.status);
  await db.partnerLead.update({ where: { id }, data: { ...v, ...(contacted ? { last_contact_at: new Date() } : {}) } });
  await writeAudit(db, { actorId: actor.userId, action: "partner.update", entityType: "project", entityId: lead.project_id, diff: { company: lead.company_name, fields: Object.keys(v), status: v.status } });
}

export async function deletePartner(db: Db, actor: ActorT, id: string) {
  assertCan(actor, { type: "partner.edit" });
  const r = await db.partnerLead.deleteMany({ where: { id, project: { term_id: actor.termId } } });
  if (!r.count) throw new ServiceError("제휴 후보를 찾을 수 없습니다.", 404);
  await writeAudit(db, { actorId: actor.userId, action: "partner.delete", entityType: "partner_lead", entityId: id });
}
