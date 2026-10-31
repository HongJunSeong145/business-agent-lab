import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetAllTables } from "@/lib/setup/reset";
import { ensureBaseSetup, ensureInitialAdmin } from "@/lib/setup/bootstrap";
import { seedDemo } from "@/lib/setup/demo";
import {
  acceptInvitation, changePassword, createInvitation, INVITE_TTL_MS, lookupInvitation, revokeInvitation, ServiceError,
} from "@/lib/services/invitations";
import { ForbiddenError, type Actor } from "@/lib/auth/can";
import { isLoginBlocked, recordLoginAttempt } from "@/lib/auth/rate-limit";
import { verifyPassword } from "@/lib/auth/password";

/** 테스트 DB(kgb_test) 전용 통합 테스트 */
beforeAll(() => {
  if (!/kgb_test/.test(process.env.DATABASE_URL ?? "")) throw new Error("통합 테스트는 kgb_test 에서만 실행");
});
afterAll(async () => prisma.$disconnect());
beforeEach(async () => {
  await resetAllTables(prisma);
});

async function leader(role: "admin" | "president" | "head" = "president"): Promise<Actor & { termId: string }> {
  const term = await ensureBaseSetup(prisma);
  const dept = await prisma.department.findFirstOrThrow({ where: { term_id: term.id, code: "planning" } });
  const u = await prisma.user.create({ data: { email: `${role}-${Math.random()}@t.test`, display_name: role, status: "active" } });
  await prisma.membership.create({ data: { user_id: u.id, term_id: term.id, role, department_id: role === "head" ? dept.id : null } });
  return { userId: u.id, role, departmentId: role === "head" ? dept.id : null, departmentCode: role === "head" ? "planning" : null, termId: term.id };
}

describe("마이그레이션·시드", () => {
  it("기본 구조와 시드는 재실행해도 중복되지 않는다", async () => {
    for (let i = 0; i < 2; i++) {
      await ensureBaseSetup(prisma);
      await ensureInitialAdmin(prisma, "admin@t.test", "admin-password-1");
      await seedDemo(prisma, undefined);
    }
    expect(await prisma.term.count()).toBe(1);
    expect(await prisma.department.count()).toBe(5);
    expect(await prisma.budgetPeriod.count()).toBe(4);
    expect(await prisma.contactColumn.count()).toBe(8);
    expect(await prisma.user.count({ where: { email: "admin@t.test" } })).toBe(1);
    expect(await prisma.memberProfile.count()).toBe(11);
    expect(await prisma.contactRow.count()).toBe(3);
    // 데모 데이터는 전부 is_demo 표시
    expect(await prisma.memberProfile.count({ where: { is_demo: false } })).toBe(0);
    expect(await prisma.user.count({ where: { is_demo: false, email: { endsWith: "@demo.kgb.invalid" } } })).toBe(0);
    // 비밀번호 없는 데모 계정은 로그인 불가 상태
    expect(await prisma.user.count({ where: { is_demo: true, status: "active" } })).toBe(0);
  });

  it("초기 관리자 비밀번호 정책 위반은 거부", async () => {
    await expect(ensureInitialAdmin(prisma, "a@t.test", "short")).rejects.toThrow(/10자/);
    expect(await ensureInitialAdmin(prisma, undefined, undefined)).toMatchObject({ created: false });
  });
});

describe("DB 무결성 제약 (4-3)", () => {
  async function makeTask() {
    const term = await ensureBaseSetup(prisma);
    const depts = await prisma.department.findMany({ where: { term_id: term.id }, orderBy: { display_order: "asc" } });
    const task = await prisma.task.create({ data: { title: "카드뉴스 제작" } });
    return { task, depts };
  }

  it("업무당 lead 국서는 1개만 (부분 고유 인덱스)", async () => {
    const { task, depts } = await makeTask();
    await prisma.taskDepartment.create({ data: { task_id: task.id, department_id: depts[3]!.id, role: "lead" } });
    await prisma.taskDepartment.create({ data: { task_id: task.id, department_id: depts[2]!.id, role: "support" } });
    await expect(prisma.taskDepartment.create({ data: { task_id: task.id, department_id: depts[0]!.id, role: "lead" } })).rejects.toThrow();
  });

  it("effective_progress 뷰는 D3 공식, 완료 해제 시 직전 값으로 복귀", async () => {
    const { task } = await makeTask();
    const eff = async () => (await prisma.$queryRaw<{ e: number }[]>`SELECT effective_progress AS e FROM task_progress WHERE task_id = ${task.id}::uuid`)[0]!.e;
    expect(await eff()).toBe(0);
    await prisma.task.update({ where: { id: task.id }, data: { ai_progress: 72 } });
    expect(await eff()).toBe(72);
    await prisma.task.update({ where: { id: task.id }, data: { manual_progress: 40 } });
    expect(await eff()).toBe(40);
    await prisma.task.update({ where: { id: task.id }, data: { is_completed: true } });
    expect(await eff()).toBe(100);
    await prisma.task.update({ where: { id: task.id }, data: { is_completed: false } });
    expect(await eff()).toBe(40);
  });

  it("CHECK 제약: 진척도 범위·상태값·자기 의존 금지", async () => {
    const { task } = await makeTask();
    await expect(prisma.task.update({ where: { id: task.id }, data: { ai_progress: 101 } })).rejects.toThrow();
    await expect(prisma.task.update({ where: { id: task.id }, data: { status: "unknown" } })).rejects.toThrow();
    await expect(prisma.taskDependency.create({ data: { task_id: task.id, depends_on_task_id: task.id } })).rejects.toThrow();
    await expect(prisma.membership.create({
      data: { user: { create: { email: "x@t.test", display_name: "x" } }, term: { connect: { id: (await ensureBaseSetup(prisma)).id } }, role: "vice_president" },
    })).rejects.toThrow();
  });

  it("pending 제안 dedupe_key 중복 금지, 처리된 제안은 같은 키 허용", async () => {
    const term = await ensureBaseSetup(prisma);
    const base = { term_id: term.id, source_type: "meeting", kind: "new_task", payload: {}, dedupe_key: "k1" };
    await prisma.proposal.create({ data: base });
    await expect(prisma.proposal.create({ data: base })).rejects.toThrow();
    await prisma.proposal.updateMany({ where: { dedupe_key: "k1" }, data: { status: "superseded" } });
    await expect(prisma.proposal.create({ data: base })).resolves.toBeTruthy();
  });
});

describe("초대 가입 (10-3)", () => {
  it("회장급이 만든 링크로 1회만 가입, 감사 로그 기록", async () => {
    const actor = await leader("president");
    const dept = await prisma.department.findFirstOrThrow({ where: { term_id: actor.termId, code: "promotion" } });
    const { token, invitation } = await createInvitation(prisma, actor, { email: "New@T.test", role: "member", departmentId: dept.id });
    expect(invitation.email).toBe("new@t.test");
    expect(invitation.token_hash).not.toBe(token); // 원문 토큰은 저장하지 않음

    const r = await acceptInvitation(prisma, token, { displayName: "신입", password: "member-password-1", passwordConfirm: "member-password-1" });
    const m = await prisma.membership.findFirstOrThrow({ where: { user_id: r.userId } });
    expect(m).toMatchObject({ role: "member", department_id: dept.id });

    await expect(acceptInvitation(prisma, token, { displayName: "x", password: "member-password-1", passwordConfirm: "member-password-1" }))
      .rejects.toBeInstanceOf(ServiceError);
    const actions = (await prisma.activityLog.findMany()).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["invitation.create", "invitation.accept"]));
    // 감사 로그에 이메일 원문이 남지 않음
    const diffs = JSON.stringify((await prisma.activityLog.findMany()).map((l) => l.diff));
    expect(diffs).not.toContain("new@t.test");
  });

  it("72시간 만료·취소된 링크는 사용 불가", async () => {
    const actor = await leader("head");
    const t0 = new Date("2026-10-31T00:00:00Z");
    const { token } = await createInvitation(prisma, actor, { email: "a@t.test", role: "president", departmentId: null }, t0);
    expect((await lookupInvitation(prisma, token, new Date(t0.getTime() + INVITE_TTL_MS - 1000))).ok).toBe(true);
    expect(await lookupInvitation(prisma, token, new Date(t0.getTime() + INVITE_TTL_MS))).toEqual({ ok: false, reason: "expired" });

    const { token: t2, invitation } = await createInvitation(prisma, actor, { email: "b@t.test", role: "president", departmentId: null });
    await revokeInvitation(prisma, actor, invitation.id);
    expect(await lookupInvitation(prisma, t2)).toEqual({ ok: false, reason: "not_found" });
  });

  it("같은 이메일 재초대 시 이전 링크 무효화", async () => {
    const actor = await leader();
    const { token: first } = await createInvitation(prisma, actor, { email: "c@t.test", role: "president", departmentId: null });
    await createInvitation(prisma, actor, { email: "c@t.test", role: "president", departmentId: null });
    expect((await lookupInvitation(prisma, first)).ok).toBe(false);
  });

  it("국원은 초대 불가(403), 국장·국원 초대는 국서 필수, 관리자 초대는 관리자만", async () => {
    const actor = await leader("president");
    const dept = await prisma.department.findFirstOrThrow({ where: { term_id: actor.termId, code: "planning" } });
    const member: Actor & { termId: string } = { ...actor, role: "member", departmentId: dept.id, departmentCode: "planning" };
    await expect(createInvitation(prisma, member, { email: "d@t.test", role: "member", departmentId: dept.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createInvitation(prisma, actor, { email: "d@t.test", role: "head", departmentId: null })).rejects.toThrow(/국서/);
    await expect(createInvitation(prisma, actor, { email: "d@t.test", role: "admin", departmentId: null })).rejects.toThrow(/관리자/);
    const admin = await leader("admin");
    await expect(createInvitation(prisma, admin, { email: "d@t.test", role: "admin", departmentId: null })).resolves.toBeTruthy();
  });

  it("비밀번호 변경 시 session_version 증가(전체 세션 무효화)", async () => {
    const actor = await leader();
    const { token } = await createInvitation(prisma, actor, { email: "e@t.test", role: "president", departmentId: null });
    const { userId } = await acceptInvitation(prisma, token, { displayName: "e", password: "old-password-1", passwordConfirm: "old-password-1" });
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).session_version;
    await expect(changePassword(prisma, userId, { current: "wrong-pass-1", next: "new-password-1", confirm: "new-password-1" }, verifyPassword)).rejects.toThrow(/현재 비밀번호/);
    await changePassword(prisma, userId, { current: "old-password-1", next: "new-password-1", confirm: "new-password-1" }, verifyPassword);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.session_version).toBe(before + 1);
    expect(await verifyPassword(after.password_hash!, "new-password-1")).toBe(true);
  });
});

describe("로그인 시도 제한 (5회/15분)", () => {
  it("계정 기준 5회 실패 시 차단, 15분 지나면 해제", async () => {
    const now = new Date();
    for (let i = 0; i < 4; i++) await recordLoginAttempt(prisma, "r@t.test", "1.1.1.1", false);
    expect(await isLoginBlocked(prisma, "r@t.test", "1.1.1.1", now)).toBe(false);
    await recordLoginAttempt(prisma, "r@t.test", "1.1.1.1", false);
    expect(await isLoginBlocked(prisma, "R@t.test", "2.2.2.2", now)).toBe(true);
    expect(await isLoginBlocked(prisma, "r@t.test", null, new Date(now.getTime() + 15 * 60 * 1000 + 1000))).toBe(false);
  });
  it("IP 기준: 여러 계정 대상 20회 실패 시 차단", async () => {
    for (let i = 0; i < 20; i++) await recordLoginAttempt(prisma, `u${i}@t.test`, "3.3.3.3", false);
    expect(await isLoginBlocked(prisma, "fresh@t.test", "3.3.3.3")).toBe(true);
    expect(await isLoginBlocked(prisma, "fresh@t.test", "4.4.4.4")).toBe(false);
  });
});
