import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetAllTables } from "@/lib/setup/reset";
import { ensureBaseSetup } from "@/lib/setup/bootstrap";
import { createProject } from "@/lib/services/projects";
import { createTask, setCompleted, setManualProgress } from "@/lib/services/tasks";
import { uploadDeliverable, updateDeliverable } from "@/lib/services/deliverables";
import { backfillPlansFromDeliverables, fieldsFromText, getPlan, planFieldsSchema, planForContext, savePlanVersion } from "@/lib/services/plans";
import { afterTaskDone } from "@/lib/services/plan-sync";
import { listReferences, requestReferences } from "@/lib/services/references";
import { runReferenceJob } from "@/lib/ai/reference";
import { MockProvider, type AiProvider, type CompleteRequest } from "@/lib/ai/provider";
import { MOCK_HANDLERS, MOCK_SEARCH_HANDLERS } from "@/lib/ai/mock";
import type { Actor } from "@/lib/auth/can";
import type { Storage } from "@/lib/storage";

/**
 * 사용자 지적(2026-11-01): 기획국이 기획안을 작업물로 올리고 완료·결재했는데 홍보국·집행국 레퍼런스가 '기획안 없음',
 * 사업 화면 기획안에도 반영 안 됨 → 기획안 업무 작업물 = 사업 기획안, 완료(회장·국장) = 결재, 레퍼런스·평가는 기획안 문서 본문 기준.
 */
class Mem implements Storage {
  readonly driver = "local" as const;
  f = new Map<string, Uint8Array>();
  async put(k: string, d: Uint8Array) { this.f.set(k, d); }
  async get(k: string) { return this.f.get(k) ?? null; }
  async delete(k: string) { this.f.delete(k); }
}
type A = Actor & { termId: string };
let pres: A, planner: A, promo: A, ops: A;
let dept: Record<string, string>;
const TODAY = "2026-10-31";
const mock = new MockProvider(MOCK_HANDLERS, MOCK_SEARCH_HANDLERS);
const PLAN_DOC = `기말고사 간식행사 기획안
행사명: 기말고사 간식행사
일시: 2026년 12월 7일 11:00~14:00
장소: 본관 1층 로비
예산: 1,000,000원
주최: 글로벌비즈니스대학 학생회
주관: 기획국
배경 및 목적: 시험 기간 학우 응원
배급 방식: 선착순 300명, 1인 1세트(샌드위치+음료)
오프라인 홍보: A2 포스터 10장, 현수막 1개`;
const txt = (s: string) => ({ name: "간식행사 기획안.txt", bytes: new TextEncoder().encode(s) });

async function user(role: "president" | "member", code?: string): Promise<A> {
  const term = await ensureBaseSetup(prisma);
  const u = await prisma.user.create({ data: { email: `${role}-${Math.random()}@t.test`, display_name: `${role}-${code ?? ""}`, status: "active" } });
  await prisma.membership.create({ data: { user_id: u.id, term_id: term.id, role, department_id: code ? dept[code] : null } });
  return { userId: u.id, role, departmentId: code ? dept[code]! : null, departmentCode: code ?? null, termId: term.id };
}
beforeAll(() => {
  if (!/kgb_test/.test(process.env.DATABASE_URL ?? "")) throw new Error("kgb_test 전용");
  process.env.KGB_FAKE_TODAY = TODAY;
  process.env.WORKER_MODE = "off";
});
afterAll(async () => {
  delete process.env.KGB_FAKE_TODAY;
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetAllTables(prisma);
  const term = await ensureBaseSetup(prisma, new Date(`${TODAY}T00:00:00Z`));
  dept = Object.fromEntries((await prisma.department.findMany({ where: { term_id: term.id } })).map((d) => [d.code, d.id]));
  pres = await user("president");
  planner = await user("member", "planning");
  promo = await user("member", "promotion");
  ops = await user("member", "operations");
});

async function setup() {
  const p = await createProject(prisma, pres, { title: "기말고사 간식행사", event_start: "2026-12-07", funding: [{ source: "student_fee", amount_planned: 1000000 }] });
  const plan = await createTask(prisma, pres, { title: "간식행사 기획안 작성(여러 버전)", lead_department_id: dept.planning, project_id: p.id });
  const poster = await createTask(prisma, pres, { title: "간식행사 홍보물 제작", lead_department_id: dept.promotion, project_id: p.id, dependencies: [{ depends_on_task_id: plan.id, type: "approval_required" }] });
  const manual = await createTask(prisma, pres, { title: "간식행사 당일 집행매뉴얼 작성", lead_department_id: dept.operations, project_id: p.id, dependencies: [{ depends_on_task_id: plan.id, type: "approval_required" }] });
  return { p, plan, poster, manual };
}

describe("기획국 작업물 → 사업 기획안", () => {
  it("기획안 업무에 문서를 올리면 기획안 새 버전(본문·첨부·양식 칸 자동 채움)이 되고, 사업 화면·홍보국 레퍼런스가 이를 기준으로 삼는다", async () => {
    const { p, plan, poster } = await setup();
    expect((await listReferences(prisma, promo, poster.id, true)).context.plan).toBeNull(); // 이전: 기획안 없음
    const up = await uploadDeliverable(prisma, new Mem(), planner, { taskId: plan.id, file: txt(PLAN_DOC) }, false);
    expect(up.planVersion).toMatchObject({ versionNo: 1 });

    const view = await getPlan(prisma, pres, p.id);
    const v = view.versions[0]!;
    expect(v.fromDeliverable).toBe(true);
    expect(v.contentText).toContain("선착순 300명");
    expect(v.file?.name).toBe("간식행사 기획안.txt");
    expect(v.fields).toMatchObject({ title: "기말고사 간식행사", venue: "본관 1층 로비", budget: 1000000, host: "글로벌비즈니스대학 학생회", organizer: "기획국", event_date: "2026-12-07" });
    expect(v.missing).toEqual([]); // 문서가 있으면 행사명·날짜만 필수

    const ctx = await planForContext(prisma, p.id);
    expect(ctx!.text).toContain("[기획안 문서 본문]");
    expect(ctx!.text).toContain("A2 포스터 10장");
    expect((await listReferences(prisma, promo, poster.id, true)).context.plan).toMatchObject({ versionNo: 1, isDraft: true });

    // 같은 버전은 두 번 가져오지 않음, 이미지 등 문서가 아니면 건너뜀
    await updateDeliverable(prisma, planner, up.deliverableId, { finalVersionId: up.versionId });
    expect((await getPlan(prisma, pres, p.id)).versions).toHaveLength(1);
  });

  it("회장·국장이 기획안 업무를 완료(또는 100%)하면 결재본 반영 → 홍보물·집행매뉴얼 착수 가능, 레퍼런스는 결재본 문서 본문으로 제작", async () => {
    const { p, plan, poster, manual } = await setup();
    await uploadDeliverable(prisma, new Mem(), planner, { taskId: plan.id, file: txt(PLAN_DOC) }, false);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: poster.id } })).status).toBe("blocked");

    // 기획국원(결재 권한 없음)이 100% 로 둬도 결재는 아님
    await prisma.taskAssignee.create({ data: { task_id: plan.id, user_id: planner.userId } });
    await setManualProgress(prisma, planner, plan.id, { value: 100 });
    expect(await afterTaskDone(prisma, planner, plan.id)).toBeNull();
    expect((await getPlan(prisma, pres, p.id)).approvedVersionId).toBeNull();

    await setCompleted(prisma, pres, plan.id, true);
    const note = await afterTaskDone(prisma, pres, plan.id);
    expect(note).toMatch(/기획안 v1을 결재본으로 반영/);
    expect((await getPlan(prisma, pres, p.id)).approvedVersionId).not.toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: poster.id } })).status).toBe("todo");
    expect((await prisma.task.findUniqueOrThrow({ where: { id: manual.id } })).status).toBe("todo");
    expect(await prisma.aiJob.count({ where: { type: "plan_rebase" } })).toBe(1);

    // 집행국 레퍼런스: '기획안 v1 (결재본)' + 문서 본문
    const refs = await listReferences(prisma, ops, manual.id, true);
    expect(refs.context.plan).toMatchObject({ versionNo: 1, isDraft: false });
    const seen: CompleteRequest[] = [];
    const spy: AiProvider = { name: "mock", available: true, model: "mock", complete: (r) => (seen.push(r), mock.complete(r)), search: (r) => mock.search(r) };
    const { aiJobId } = await requestReferences(prisma, ops, manual.id, {}, true);
    await runReferenceJob(prisma, spy, aiJobId);
    const doc = seen.flatMap((r) => r.documents ?? []).find((d) => d.name.startsWith("기획안 v1"));
    expect(doc?.name).toContain("결재본");
    expect(doc?.content).toContain("선착순 300명");
  });

  it("양식만 고쳐 새 버전으로 저장해도 기획안 문서(첨부·본문)를 이어받는다", async () => {
    const { p, plan } = await setup();
    await uploadDeliverable(prisma, new Mem(), planner, { taskId: plan.id, file: txt(PLAN_DOC) }, false);
    const cur = (await getPlan(prisma, pres, p.id)).versions[0]!;
    await savePlanVersion(prisma, new Mem(), planner, p.id, { fields: { ...cur.fields, venue: "본관 2층" } });
    const v2 = (await getPlan(prisma, pres, p.id)).versions[0]!;
    expect(v2).toMatchObject({ versionNo: 2, fields: expect.objectContaining({ venue: "본관 2층" }) });
    expect(v2.contentText).toContain("선착순 300명");
    expect(v2.file?.name).toBe("간식행사 기획안.txt");
  });

  it("문서 본문에서 양식 칸 채우기(빈 칸만)", () => {
    const f = fieldsFromText(PLAN_DOC, planFieldsSchema.parse({ venue: "이미 입력됨" }));
    expect(f).toMatchObject({ title: "기말고사 간식행사", venue: "이미 입력됨", budget: 1000000, datetime: "2026년 12월 7일 11:00~14:00" });
  });
});

describe("배포 시 한 번: 이미 올린 기획안 연결", () => {
  it("예전에 올린 기획안 작업물을 기획안으로, 완료된 업무는 결재본으로 — 다시 실행해도 그대로", async () => {
    const { p, plan, poster } = await setup();
    // 이 기능 전에 올라간 작업물 재현(가져오기 없이 직접 저장)
    const d = await prisma.deliverable.create({ data: { task_id: plan.id, title: "간식행사 기획안" } });
    await prisma.deliverableVersion.create({ data: { deliverable_id: d.id, version_no: 1, storage_key: "k1", original_name: "기획안.pdf", mime: "application/pdf", uploaded_by: planner.userId, extracted_text: PLAN_DOC } });
    await prisma.task.update({ where: { id: plan.id }, data: { is_completed: true, completed_by: pres.userId, status: "done" } });

    const r = await backfillPlansFromDeliverables(prisma);
    expect(r).toEqual({ imported: 1, approved: 1 });
    const view = await getPlan(prisma, pres, p.id);
    expect(view.approvedVersionId).not.toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: poster.id } })).status).toBe("todo");
    expect(await backfillPlansFromDeliverables(prisma)).toEqual({ imported: 0, approved: 0 });
  });
});
