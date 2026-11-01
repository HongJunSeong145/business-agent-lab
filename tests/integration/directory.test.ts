import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetAllTables } from "@/lib/setup/reset";
import { ensureBaseSetup } from "@/lib/setup/bootstrap";
import { seedDemo } from "@/lib/setup/demo";
import {
  addContactColumn, createContactRow, createProfile, deleteContactRow, deleteProfile, listContacts, listProfiles, renameContactColumn,
  setContactColumnDeleted, updateBanner, updateContactRow, updateProfile,
} from "@/lib/services/directory";
import { globalSearch } from "@/lib/services/search";
import { createProject } from "@/lib/services/projects";
import { createTask } from "@/lib/services/tasks";
import { listNotifications, markNotificationsRead } from "@/lib/services/notifications";
import { AiBudgetExceededError, assertBudget } from "@/lib/ai/structured";
import { ForbiddenError, type Actor } from "@/lib/auth/can";
import type { Storage } from "@/lib/storage";

/** Phase 8: 인적사항(T21)·연락망(T22)·배너·전역 검색·알림·AI 하루 상한 */
class MemoryStorage implements Storage {
  readonly driver = "local" as const;
  files = new Map<string, Uint8Array>();
  async put(k: string, d: Uint8Array) { this.files.set(k, d); }
  async get(k: string) { return this.files.get(k) ?? null; }
  async delete(k: string) { this.files.delete(k); }
}
type A = Actor & { termId: string };
let pres: A, member: A;

async function actor(email: string): Promise<A> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { memberships: { include: { department: true } } } });
  await prisma.user.update({ where: { id: u.id }, data: { status: "active" } });
  const m = u.memberships[0]!;
  return { userId: u.id, role: m.role as A["role"], departmentId: m.department_id, departmentCode: m.department?.code ?? null, termId: m.term_id };
}

beforeAll(() => {
  if (!/kgb_test/.test(process.env.DATABASE_URL ?? "")) throw new Error("kgb_test 전용");
});
afterAll(async () => prisma.$disconnect());
beforeEach(async () => {
  await resetAllTables(prisma);
  await ensureBaseSetup(prisma, new Date("2026-10-31T00:00:00Z"));
  await seedDemo(prisma, undefined);
  pres = await actor("president@demo.kgb.invalid");
  member = await actor("promotion.member@demo.kgb.invalid");
});

describe("T21 인적사항", () => {
  it("국원은 자기 행만 편집(UI 비활성 표시 + 서버 403), 회장은 전체·추가·삭제, 감사 로그엔 값 대신 필드명", async () => {
    const view = await listProfiles(prisma, member);
    const own = view.rows.find((r) => r.user_id === member.userId)!;
    const other = view.rows.find((r) => r.user_id && r.user_id !== member.userId)!;
    expect(view.canCreate).toBe(false);
    expect(own.canEdit).toBe(true);
    expect(other.canEdit).toBe(false);
    await expect(updateProfile(prisma, member, other.id, { phone: "010-9999-9999" })).rejects.toBeInstanceOf(ForbiddenError);
    await updateProfile(prisma, member, own.id, { major: "새 전공" });
    await expect(createProfile(prisma, member, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteProfile(prisma, member, other.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateProfile(prisma, member, own.id, { gmail: "not-mail" })).rejects.toThrow(/G-mail/);

    await updateProfile(prisma, pres, other.id, { phone: "010-1111-2222" });
    const p = await createProfile(prisma, pres, { name: "새 국원", position_title: "홍보국원" });
    await deleteProfile(prisma, pres, p.id);
    expect((await listProfiles(prisma, pres)).rows.some((r) => r.id === p.id)).toBe(false);
    const log = await prisma.activityLog.findFirstOrThrow({ where: { action: "profile.update", entity_id: other.id } });
    expect(JSON.stringify(log.diff)).not.toContain("010-1111-2222");
    expect(log.diff).toEqual({ fields: ["phone"] });
  });
});

describe("T22 연락망", () => {
  it("열 추가·이름 변경·삭제·되돌리기가 DB 에 반영(값 보존), 행 편집은 국원도 가능, 열 편집은 회장·국장만", async () => {
    const col = await addContactColumn(prisma, pres, { label: "제휴 조건" });
    await expect(addContactColumn(prisma, pres, { label: "제휴 조건" })).rejects.toThrow(/같은 이름/);
    await expect(addContactColumn(prisma, member, { label: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    const row = await createContactRow(prisma, member, { data: { org: "새 카페", [col.key]: "10% 할인", hacker: "무시" } });
    expect(row.data).toEqual({ org: "새 카페", [col.key]: "10% 할인" }); // 없는 열 값은 버림
    await updateContactRow(prisma, member, row.id, { data: { note: "답장 대기" } });
    await renameContactColumn(prisma, pres, col.id, { label: "제휴 혜택" });
    await expect(renameContactColumn(prisma, member, col.id, { label: "y" })).rejects.toBeInstanceOf(ForbiddenError);

    await setContactColumnDeleted(prisma, pres, col.id, true);
    let v = await listContacts(prisma, pres);
    expect(v.columns.some((c) => c.id === col.id)).toBe(false);
    expect(v.deletedColumns.map((c) => c.label)).toContain("제휴 혜택");
    await setContactColumnDeleted(prisma, pres, col.id, false);
    v = await listContacts(prisma, member);
    expect(v.columns.find((c) => c.id === col.id)?.label).toBe("제휴 혜택");
    expect(v.rows.find((r) => r.id === row.id)!.data).toMatchObject({ [col.key]: "10% 할인", note: "답장 대기" }); // 값 보존
    expect(v.canEditColumns).toBe(false);
    await deleteContactRow(prisma, member, row.id);
    expect((await listContacts(prisma, member)).rows.some((r) => r.id === row.id)).toBe(false);
  });
});

describe("배너", () => {
  it("제목·부제·사진 저장(이미지 형식만), 국원 불가", async () => {
    const storage = new MemoryStorage();
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    await expect(updateBanner(prisma, storage, member, { title: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateBanner(prisma, storage, pres, { title: "x" }, { name: "a.pdf", bytes: new TextEncoder().encode("%PDF-1.4") })).rejects.toThrow(/이미지/);
    await updateBanner(prisma, storage, pres, { title: "새 배너", subtitle: "함께 만드는 학생회" }, { name: "a.png", bytes: png });
    const t = await prisma.term.findUniqueOrThrow({ where: { id: pres.termId } });
    expect(t).toMatchObject({ banner_title: "새 배너", banner_subtitle: "함께 만드는 학생회" });
    expect(storage.files.has(t.banner_image_key!)).toBe(true);
    await updateBanner(prisma, storage, pres, { title: "새 배너" }, null, true);
    expect((await prisma.term.findUniqueOrThrow({ where: { id: pres.termId } })).banner_image_key).toBeNull();
    expect(storage.files.size).toBe(0); // 이전 사진 정리
  });
});

describe("전역 검색·알림·AI 상한", () => {
  it("사업·업무·회의록 본문·연락망·인적사항(이름)을 찾고, 연락처 값(전화)으로는 인적사항을 찾지 않는다", async () => {
    const proj = await createProject(prisma, pres, { title: "종강 간식 나눔", event_start: "2026-12-09" });
    const lead = (await prisma.department.findFirstOrThrow({ where: { term_id: pres.termId, code: "promotion" } })).id;
    await createTask(prisma, pres, { title: "간식 카드뉴스", lead_department_id: lead, project_id: proj.id });
    const hits = await globalSearch(prisma, member, "간식");
    expect(hits.some((h) => h.kind === "project")).toBe(true);
    expect(hits.some((h) => h.kind === "task" && h.href.includes("?task="))).toBe(true);
    expect((await globalSearch(prisma, member, "데모카페")).some((h) => h.kind === "contact")).toBe(true);
    expect((await globalSearch(prisma, member, "장홍보")).some((h) => h.kind === "profile")).toBe(true);
    const phone = (await prisma.memberProfile.findFirstOrThrow({ where: { phone: { not: null } } })).phone!;
    expect((await globalSearch(prisma, member, phone)).some((h) => h.kind === "profile")).toBe(false);
    expect(await globalSearch(prisma, member, "   ")).toEqual([]);
  });

  it("알림 목록·읽음 처리는 자기 알림만", async () => {
    await prisma.notification.createMany({ data: [{ user_id: member.userId, type: "t", title: "A" }, { user_id: member.userId, type: "t", title: "B" }, { user_id: pres.userId, type: "t", title: "C" }] });
    const n = await listNotifications(prisma, member.userId);
    expect(n.unread).toBe(2);
    await markNotificationsRead(prisma, member.userId, [n.items[0]!.id]);
    expect((await listNotifications(prisma, member.userId)).unread).toBe(1);
    expect(await markNotificationsRead(prisma, member.userId)).toBe(1);
    expect((await listNotifications(prisma, pres.userId)).unread).toBe(1); // 남의 알림은 그대로
  });

  it("AI 하루 상한 30,000원: 설정값이 더 커도 30,000원에서 멈추고, 그 아래면 통과 / 예전 기본값 3,000·10,000은 시작 시 30,000으로", async () => {
    await prisma.aiRun.create({ data: { agent: "a5", model: "x", output_valid: true, cost_estimate_krw: 20000 } });
    await expect(assertBudget(prisma, 30000)).resolves.toBeUndefined();
    await expect(assertBudget(prisma, 10000)).rejects.toBeInstanceOf(AiBudgetExceededError); // 설정을 낮추면 그 값
    await prisma.aiRun.create({ data: { agent: "a5", model: "x", output_valid: true, cost_estimate_krw: 10000 } });
    await expect(assertBudget(prisma, 50000)).rejects.toBeInstanceOf(AiBudgetExceededError); // 상한 30,000
    for (const old of [3000, 10000]) {
      await prisma.setting.update({ where: { term_id_key: { term_id: pres.termId, key: "AI_DAILY_BUDGET_KRW" } }, data: { value: old } });
      await ensureBaseSetup(prisma);
      expect((await prisma.setting.findUniqueOrThrow({ where: { term_id_key: { term_id: pres.termId, key: "AI_DAILY_BUDGET_KRW" } } })).value).toBe(30000);
    }
    await prisma.setting.update({ where: { term_id_key: { term_id: pres.termId, key: "AI_DAILY_BUDGET_KRW" } }, data: { value: 5000 } });
    await ensureBaseSetup(prisma);
    expect((await prisma.setting.findUniqueOrThrow({ where: { term_id_key: { term_id: pres.termId, key: "AI_DAILY_BUDGET_KRW" } } })).value).toBe(5000); // 사용자가 정한 값은 그대로
  });
});
