import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { assertCan, ROLES, type Actor } from "@/lib/auth/can";
import { hashPassword, validatePasswordPolicy } from "@/lib/auth/password";
import { writeAudit } from "@/lib/audit/log";

/** 지시서 10-3: 가입은 초대 링크만, 만료 72시간, 1회용 */
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const createInvitationSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("이메일 형식이 올바르지 않습니다.").max(200),
    role: z.enum(ROLES),
    departmentId: z.string().uuid().nullable(),
  })
  .refine((v) => !(v.role === "head" || v.role === "member") || v.departmentId, {
    message: "국장·국원은 소속 국서를 선택해야 합니다.",
    path: ["departmentId"],
  });

export type CreateInvitationInput = z.input<typeof createInvitationSchema>;

export class ServiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ServiceError";
  }
}

export async function createInvitation(db: Db, actor: Actor & { termId: string }, raw: unknown, now = new Date()) {
  assertCan(actor, { type: "members.manage" });
  const parsed = createInvitationSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError(parsed.error.issues[0]?.message ?? "입력값 오류");
  const input = parsed.data;
  // 관리자 역할 부여는 관리자만
  if (input.role === "admin" && actor.role !== "admin") throw new ServiceError("관리자 초대는 관리자만 할 수 있습니다.", 403);

  const existing = await db.user.findUnique({ where: { email: input.email }, include: { memberships: { where: { term_id: actor.termId } } } });
  if (existing && existing.status === "active" && existing.memberships.length > 0) {
    throw new ServiceError("이미 가입된 회원입니다.");
  }
  if (input.departmentId) {
    const dept = await db.department.findFirst({ where: { id: input.departmentId, term_id: actor.termId } });
    if (!dept) throw new ServiceError("국서를 찾을 수 없습니다.");
  }

  const token = randomBytes(32).toString("base64url");
  const invitation = await db.$transaction(async (tx) => {
    // 같은 이메일의 미사용 초대는 무효화(최신 링크만 유효)
    await tx.invitation.updateMany({
      where: { email: input.email, term_id: actor.termId, accepted_at: null, revoked_at: null },
      data: { revoked_at: now },
    });
    const inv = await tx.invitation.create({
      data: {
        email: input.email,
        term_id: actor.termId,
        role: input.role,
        department_id: input.role === "president" || input.role === "admin" ? null : input.departmentId,
        token_hash: hashToken(token),
        expires_at: new Date(now.getTime() + INVITE_TTL_MS),
        invited_by: actor.userId,
      },
    });
    await writeAudit(tx, {
      actorId: actor.userId,
      action: "invitation.create",
      entityType: "invitation",
      entityId: inv.id,
      diff: { email: input.email, role: input.role, department_id: inv.department_id },
    });
    return inv;
  });
  return { invitation, token };
}

export async function revokeInvitation(db: Db, actor: Actor & { termId: string }, invitationId: string, now = new Date()) {
  assertCan(actor, { type: "members.manage" });
  await db.$transaction(async (tx) => {
    const r = await tx.invitation.updateMany({
      where: { id: invitationId, term_id: actor.termId, accepted_at: null, revoked_at: null },
      data: { revoked_at: now },
    });
    if (r.count === 0) throw new ServiceError("취소할 수 있는 초대가 아닙니다.");
    await writeAudit(tx, { actorId: actor.userId, action: "invitation.revoke", entityType: "invitation", entityId: invitationId });
  });
}

export type InvitationLookup =
  | { ok: true; invitation: { id: string; email: string; role: string; departmentName: string | null } }
  | { ok: false; reason: "not_found" | "expired" | "used" };

export async function lookupInvitation(db: Db, token: string, now = new Date()): Promise<InvitationLookup> {
  const inv = await db.invitation.findUnique({ where: { token_hash: hashToken(token) }, include: { department: true } });
  if (!inv || inv.revoked_at) return { ok: false, reason: "not_found" };
  if (inv.accepted_at) return { ok: false, reason: "used" };
  if (inv.expires_at.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, invitation: { id: inv.id, email: inv.email, role: inv.role, departmentName: inv.department?.name_ko ?? null } };
}

export const acceptInvitationSchema = z
  .object({
    displayName: z.string().trim().min(1, "이름을 입력하세요.").max(50),
    password: z.string(),
    passwordConfirm: z.string(),
  })
  .refine((v) => v.password === v.passwordConfirm, { message: "비밀번호 확인이 일치하지 않습니다.", path: ["passwordConfirm"] });

export async function acceptInvitation(db: Db, token: string, raw: unknown, now = new Date()) {
  const parsed = acceptInvitationSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError(parsed.error.issues[0]?.message ?? "입력값 오류");
  const policy = validatePasswordPolicy(parsed.data.password);
  if (policy) throw new ServiceError(policy);

  const lookup = await lookupInvitation(db, token, now);
  if (!lookup.ok) throw new ServiceError(lookup.reason === "expired" ? "초대 링크가 만료되었습니다." : "유효하지 않은 초대 링크입니다.", 410);

  const password_hash = await hashPassword(parsed.data.password);
  return db.$transaction(async (tx) => {
    // 동시 사용 방지: 조건부 업데이트로 1회만 통과
    const claimed = await tx.invitation.updateMany({
      where: { id: lookup.invitation.id, accepted_at: null, revoked_at: null, expires_at: { gt: now } },
      data: { accepted_at: now },
    });
    if (claimed.count !== 1) throw new ServiceError("이미 사용된 초대 링크입니다.", 410);
    const inv = await tx.invitation.findUniqueOrThrow({ where: { id: lookup.invitation.id } });

    const user = await tx.user.upsert({
      where: { email: inv.email },
      update: {
        display_name: parsed.data.displayName,
        password_hash,
        status: "active",
        password_changed_at: now,
        session_version: { increment: 1 },
      },
      create: {
        email: inv.email,
        display_name: parsed.data.displayName,
        password_hash,
        status: "active",
        password_changed_at: now,
      },
    });
    await tx.membership.upsert({
      where: { user_id_term_id: { user_id: user.id, term_id: inv.term_id } },
      update: { role: inv.role, department_id: inv.department_id },
      create: { user_id: user.id, term_id: inv.term_id, role: inv.role, department_id: inv.department_id },
    });
    await writeAudit(tx, {
      actorId: user.id,
      action: "invitation.accept",
      entityType: "user",
      entityId: user.id,
      diff: { role: inv.role, department_id: inv.department_id },
    });
    return { userId: user.id, email: inv.email };
  });
}

/** 비밀번호 변경 → session_version 증가로 모든 세션 무효화 (10-3) */
export const changePasswordSchema = z
  .object({ current: z.string().min(1, "현재 비밀번호를 입력하세요."), next: z.string(), confirm: z.string() })
  .refine((v) => v.next === v.confirm, { message: "새 비밀번호 확인이 일치하지 않습니다.", path: ["confirm"] });

export async function changePassword(db: Db, userId: string, raw: unknown, verify: (hash: string, pw: string) => Promise<boolean>) {
  const parsed = changePasswordSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError(parsed.error.issues[0]?.message ?? "입력값 오류");
  const policy = validatePasswordPolicy(parsed.data.next);
  if (policy) throw new ServiceError(policy);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.password_hash || !(await verify(user.password_hash, parsed.data.current))) {
    throw new ServiceError("현재 비밀번호가 올바르지 않습니다.");
  }
  const password_hash = await hashPassword(parsed.data.next);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { password_hash, password_changed_at: new Date(), session_version: { increment: 1 } },
    });
    await writeAudit(tx, { actorId: userId, action: "user.password_change", entityType: "user", entityId: userId });
  });
}
