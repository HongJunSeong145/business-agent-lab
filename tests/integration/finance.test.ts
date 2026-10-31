import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetAllTables } from "@/lib/setup/reset";
import { ensureBaseSetup } from "@/lib/setup/bootstrap";
import { createProject } from "@/lib/services/projects";
import { createTask } from "@/lib/services/tasks";
import {
  addBudgetLine, addPurchase, deleteEvidence, getQuarter, projectFinance, quarterCsv, setPeriodStatus, setPurchaseStatus, updateBudgetLine, uploadEvidence, verifyEvidence,
} from "@/lib/services/finance";
import { addPartner, listPartners, updatePartner } from "@/lib/services/partners";
import { runMonitor, runMonitorNow } from "@/lib/services/monitor";
import { MockProvider } from "@/lib/ai/provider";
import { MOCK_HANDLERS } from "@/lib/ai/mock";
import { ForbiddenError, type Actor } from "@/lib/auth/can";
import type { Storage } from "@/lib/storage";

/** Phase 9: 재정(T8·T9)·증빙 누락 탐지(T20)·A7 모니터링·CSV·제휴 후보 */
class MemoryStorage implements Storage {
  readonly driver = "local" as const;
  files = new Map<string, Uint8Array>();
  async put(k: string, d: Uint8Array) { this.files.set(k, d); }
  async get(k: string) { return this.files.get(k) ?? null; }
  async delete(k: string) { this.files.delete(k); }
}
type A = Actor & { termId: string };
let pres: A, fin: A, promo: A, sec: A, secHead: A;
let dept: Record<string, string>;
let storage: MemoryStorage;
const TODAY = "2026-10-31";
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

async function user(role: "president" | "head" | "member", code?: string): Promise<A> {
  const term = await ensureBaseSetup(prisma);
  const u = await prisma.user.create({ data: { email: `${role}-${Math.random()}@t.test`, display_name: `${role}-${code ?? ""}`, status: "active" } });
  await prisma.membership.create({ data: { user_id: u.id, term_id: term.id, role, department_id: code ? dept[code] : null } });
  return { userId: u.id, role, departmentId: code ? dept[code]! : null, departmentCode: code ?? null, termId: term.id };
}
const notes = (userId: string, type?: string) => prisma.notification.findMany({ where: { user_id: userId, ...(type ? { type } : {}) } });

beforeAll(() => {
  if (!/kgb_test/.test(process.env.DATABASE_URL ?? "")) throw new Error("kgb_test 전용");
  process.env.KGB_FAKE_TODAY = TODAY;
});
afterAll(async () => {
  delete process.env.KGB_FAKE_TODAY;
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetAllTables(prisma);
  const term = await ensureBaseSetup(prisma, new Date(`${TODAY}T00:00:00Z`));
  await prisma.term.update({ where: { id: term.id }, data: { is_current: true } });
  dept = Object.fromEntries((await prisma.department.findMany({ where: { term_id: term.id } })).map((d) => [d.code, d.id]));
  pres = await user("president");
  fin = await user("member", "finance");
  promo = await user("member", "promotion");
  sec = await user("member", "secretariat");
  secHead = await user("head", "secretariat");
  storage = new MemoryStorage();
});

describe("T9 세금·분기 예결산·CSV", () => {
  it("교비 1,000,000 → 세금 100,000·총액 1,100,000, 학생회비는 세금 없음, 재정국만 편집, CSV(BOM·수식 주입 방지)", async () => {
    const p = await createProject(prisma, pres, { title: "가을 축제", event_start: "2026-11-20", funding: [{ source: "school", amount_planned: 1000000 }] });
    await addBudgetLine(prisma, fin, 4, { project_id: p.id, funding_source: "school", item: "무대 대여", planned_amount: 1000000 });
    await addBudgetLine(prisma, fin, 4, { funding_source: "student_fee", item: "=HYPERLINK(\"x\")", planned_amount: 200000 });
    await expect(addBudgetLine(prisma, promo, 4, { item: "x", planned_amount: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    let q = await getQuarter(prisma, fin, 4);
    expect(q.period.reviewLabel).toBe("3·4분기 심사");
    const line = q.lines.find((l) => l.item === "무대 대여")!;
    expect([line.planned, line.tax, line.planned + line.tax]).toEqual([1000000, 100000, 1100000]);
    expect(q.totals).toEqual({ planned: 1200000, tax: 100000, plannedWithTax: 1300000, actual: 0 });
    await updateBudgetLine(prisma, fin, line.id, { actual_amount: 950000, funding_source: "student_fee" }); // 재원 변경 → 세금 재계산
    q = await getQuarter(prisma, fin, 4);
    expect(q.lines.find((l) => l.id === line.id)).toMatchObject({ tax: 0, actual: 950000 });
    await setPeriodStatus(prisma, fin, 4, { kind: "budget", status: "submitted" });
    expect((await getQuarter(prisma, promo, 4)).period.budgetStatus).toBe("submitted");
    const csv = await quarterCsv(prisma, promo, 4);
    expect(csv.startsWith("﻿분기,사업")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain("4,합계,,,,1200000,0,1200000,950000");
    await expect(getQuarter(prisma, fin, 5)).rejects.toThrow(/1~4/);
  });
});

describe("구입 리스트·증빙", () => {
  it("구입 완료 → 영수증 누락 표시 → 아무나 영수증 업로드 → 재정국 검수, 검수된 증빙은 재정국만 삭제", async () => {
    const p = await createProject(prisma, pres, { title: "간식 나눔", event_start: "2026-12-09", expected_beneficiaries: 80, funding: [{ source: "student_fee", amount_planned: 400000 }] });
    const it = await addPurchase(prisma, fin, p.id, { name: "과자", qty: 80, unit_price: 3000, funding_source: "student_fee" });
    await expect(addPurchase(prisma, promo, p.id, { name: "x", qty: 1, unit_price: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await setPurchaseStatus(prisma, fin, it.id, { status: "purchased" });
    let v = await projectFinance(prisma, promo, p.id);
    expect(v.rosterRequired).toBe(true); // T8: 80명 → 명단 필수
    expect(v.purchases[0]).toMatchObject({ amount: 240000, receiptMissing: true });
    const ev = await uploadEvidence(prisma, storage, promo, p.id, { purchaseItemId: it.id, file: { name: "영수증.png", bytes: PNG } });
    v = await projectFinance(prisma, promo, p.id);
    expect(v.purchases[0]!.receiptMissing).toBe(false);
    expect(v.requirements.find((r) => r.type === "receipt")!.met).toBe(true);
    await expect(verifyEvidence(prisma, promo, ev.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await verifyEvidence(prisma, fin, ev.id, true);
    await expect(deleteEvidence(prisma, promo, ev.id)).rejects.toThrow(/재정국/);
    await expect(uploadEvidence(prisma, storage, promo, p.id, { file: { name: "a.png", bytes: PNG } })).rejects.toThrow(/어떤 증빙/);
    await expect(uploadEvidence(prisma, storage, promo, p.id, { purchaseItemId: it.id, file: { name: "a.exe", bytes: new Uint8Array([77, 90]) } })).rejects.toThrow(/지원하지 않는/);
    const roster = v.requirements.find((r) => r.type === "beneficiary_roster")!;
    await uploadEvidence(prisma, storage, promo, p.id, { requirementId: roster.id, file: { name: "명단.pdf", bytes: new Uint8Array(await import("node:fs").then((f) => f.readFileSync("tests/fixtures/minutes/minutes.pdf"))) } });
    expect((await projectFinance(prisma, promo, p.id)).requirements.find((r) => r.type === "beneficiary_roster")!.met).toBe(true);
  });
});

describe("T20 증빙 누락 탐지·A7 모니터링", () => {
  it("구입 완료 후 영수증 없음 → 재정국·구입 담당자 알림 1회(같은 날 다시 돌려도 중복 없음) → 시간이 지나면 등급 상승 → 영수증 올리면 멈춤", async () => {
    const p = await createProject(prisma, pres, { title: "간식 나눔", event_start: "2026-12-09", expected_beneficiaries: 150, funding: [{ source: "student_fee", amount_planned: 400000 }] });
    const it = await addPurchase(prisma, fin, p.id, { name: "과자", qty: 10, unit_price: 1000 });
    await setPurchaseStatus(prisma, fin, it.id, { status: "purchased" });
    await prisma.purchaseItem.update({ where: { id: it.id }, data: { purchased_at: new Date("2026-10-30T03:00:00Z"), purchased_by: promo.userId } });

    const r1 = await runMonitor(prisma, pres.termId, { today: TODAY });
    expect(r1.alerts.filter((a) => a.kind === "receipt_missing")).toHaveLength(1);
    expect((await notes(fin.userId, "monitor_receipt_missing")).map((n) => n.severity)).toEqual(["info"]);
    expect(await notes(promo.userId, "monitor_receipt_missing")).toHaveLength(1); // 구입 담당자
    expect(await notes(sec.userId, "monitor_receipt_missing")).toHaveLength(0);
    await runMonitor(prisma, pres.termId, { today: TODAY });
    expect(await notes(fin.userId, "monitor_receipt_missing")).toHaveLength(1); // 중복 없음

    await runMonitor(prisma, pres.termId, { today: "2026-11-07" });
    await runMonitor(prisma, pres.termId, { today: "2026-11-10" });
    expect((await notes(fin.userId, "monitor_receipt_missing")).map((n) => n.severity).sort()).toEqual(["critical", "info", "warn"]); // 등급 상승

    await uploadEvidence(prisma, storage, fin, p.id, { purchaseItemId: it.id, file: { name: "r.png", bytes: PNG } });
    const after = await runMonitor(prisma, pres.termId, { today: "2026-11-11" });
    expect(after.alerts.filter((a) => a.kind === "receipt_missing")).toHaveLength(0);
  });

  it("'지금 점검'(회장·국장): 마감 임박·초과 → 담당자, 사무국장·회장에게 노티스(mock A7 문장), 국원은 실행 불가, 감사 로그", async () => {
    await createTask(prisma, pres, { title: "카드뉴스", lead_department_id: dept.promotion!, assignee_ids: [promo.userId], due_date: "2026-11-02" });
    await createTask(prisma, pres, { title: "보고서", lead_department_id: dept.secretariat!, due_date: "2026-10-25" }); // 담당자 없음 → 국장
    await expect(runMonitorNow(prisma, promo, null)).rejects.toBeInstanceOf(ForbiddenError);
    const r = await runMonitorNow(prisma, pres, new MockProvider(MOCK_HANDLERS));
    expect(r.usedAi).toBe(true);
    expect((await notes(promo.userId, "monitor_deadline"))[0]).toMatchObject({ severity: "warn", title: "마감 D-2: 카드뉴스" });
    expect((await notes(secHead.userId, "monitor_overdue"))[0]).toMatchObject({ severity: "critical" });
    const notice = (await notes(secHead.userId, "monitor_weekly")).concat(await notes(secHead.userId, "monitor_daily"));
    expect(notice).toHaveLength(1);
    expect(notice[0]!.body).toContain("mock 노티스");
    expect(await notes(pres.userId, notice[0]!.type)).toHaveLength(1);
    expect(await prisma.activityLog.count({ where: { action: "monitor.run" } })).toBe(1);
    // AI 없이도 코드 문장으로 노티스
    const r2 = await runMonitor(prisma, pres.termId, { today: "2026-11-01", provider: null });
    expect(r2.usedAi).toBe(false);
    expect(r2.sentence).toMatch(/초과 1/);
  });

  it("교비 사업 행정실 송부(D-21) 미완료 → 회장·기획국장 critical", async () => {
    const planHead = await user("head", "planning");
    const p = await createProject(prisma, pres, { title: "교비 행사", event_start: "2026-11-20", funding: [{ source: "school", amount_planned: 100000 }] });
    await prisma.task.create({ data: { title: "공문·기획안 행정실 송부", project_id: p.id, template_key: "PRES_SUBMIT_SCHOOL", due_date: new Date("2026-10-30T00:00:00Z"), departments: { create: { department_id: dept.planning!, role: "lead" } } } });
    await runMonitor(prisma, pres.termId, { today: TODAY });
    expect((await notes(planHead.userId, "monitor_school_submit"))[0]?.severity).toBe("critical");
    expect(await notes(pres.userId, "monitor_school_submit")).toHaveLength(1);
  });
});

describe("제휴 후보", () => {
  it("사무국·회장만 편집, 문의 상태로 바꾸면 마지막 연락일 기록", async () => {
    const p = await createProject(prisma, pres, { title: "축제" });
    await expect(addPartner(prisma, promo, p.id, { company_name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addPartner(prisma, sec, p.id, { company_name: "x", website: "javascript:1" })).rejects.toThrow(/http/);
    const l = await addPartner(prisma, sec, p.id, { company_name: "데모카페", website: "https://example.com", contact_channel: "공식 제휴 폼" });
    await updatePartner(prisma, sec, l.id, { status: "contacted" });
    const v = await listPartners(prisma, promo, p.id);
    expect(v.canEdit).toBe(false);
    expect(v.rows[0]).toMatchObject({ status: "contacted" });
    expect(v.rows[0]!.last_contact_at).toBeTruthy();
  });
});
