import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetAllTables } from "@/lib/setup/reset";
import { ensureBaseSetup } from "@/lib/setup/bootstrap";
import { createProject, moveProjectDates } from "@/lib/services/projects";
import { applyStandardTemplate } from "@/lib/services/schedule";
import { bulkUpdateTasks, createTask, setCompleted, setManualProgress, updateTask } from "@/lib/services/tasks";
import { approvePlan, getPlan, requestPlanReferences, savePlanVersion } from "@/lib/services/plans";
import { decideProposals } from "@/lib/services/proposals";
import { listReferences, requestReferences } from "@/lib/services/references";
import { projectArchive, updateDeliverable, uploadDeliverable } from "@/lib/services/deliverables";
import { runPlanRebaseJob } from "@/lib/ai/plan-rebase";
import { runReferenceJob } from "@/lib/ai/reference";
import { runEvaluateJob } from "@/lib/ai/evaluate";
import { buildProposals } from "@/lib/ai/propose";
import { MockProvider, type AiProvider, type CompleteRequest } from "@/lib/ai/provider";
import { MOCK_HANDLERS, MOCK_SEARCH_HANDLERS } from "@/lib/ai/mock";
import { DEFAULT_PARAMS } from "@kgb/rules";
import type { Actor } from "@/lib/auth/can";
import type { Storage } from "@/lib/storage";

/**
 * 사용자 요구 재점검(2026-11-01): 행사일 미정, 담당자 미추천, 결재 기획안 기준 재배정·레퍼런스·평가,
 * 기획국 레퍼런스 기획안, 사업 자동 완료·작업물 보관함·최종본, 일괄 수정
 */
class MemoryStorage implements Storage {
  readonly driver = "local" as const;
  files = new Map<string, Uint8Array>();
  async put(k: string, d: Uint8Array) { this.files.set(k, d); }
  async get(k: string) { return this.files.get(k) ?? null; }
  async delete(k: string) { this.files.delete(k); }
}
type A = Actor & { termId: string };
let pres: A, planner: A, promo: A, fin: A;
let dept: Record<string, string>;
let storage: MemoryStorage;
const mock = new MockProvider(MOCK_HANDLERS, MOCK_SEARCH_HANDLERS);
const TODAY = "2026-10-31";
const FIELDS = {
  title: "기말고사 간식 나눔", event_date: "2026-12-11", datetime: "12월 11일 12:00", venue: "데모관 2층", budget: 400000, host: "학생회", organizer: "기획국",
  purpose: "시험 응원", content: "간식 배부", timetable: [{ time: "11:00", item: "현장 리허설" }, { time: "12:00", item: "배부" }], budget_scenarios: [],
};

async function user(role: "president" | "member", code?: string): Promise<A> {
  const term = await ensureBaseSetup(prisma);
  const u = await prisma.user.create({ data: { email: `${role}-${Math.random()}@t.test`, display_name: `${role}-${code ?? ""}`, status: "active" } });
  await prisma.membership.create({ data: { user_id: u.id, term_id: term.id, role, department_id: code ? dept[code] : null } });
  return { userId: u.id, role, departmentId: code ? dept[code]! : null, departmentCode: code ?? null, termId: term.id };
}
const task = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });

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
  fin = await user("member", "finance");
  storage = new MemoryStorage();
});

async function eventProject(date = "2026-12-09") {
  const p = await createProject(prisma, pres, { title: "간식 나눔", event_start: date, venue: "데모관", expected_beneficiaries: 80, funding: [{ source: "student_fee", amount_planned: 400000 }] });
  await applyStandardTemplate(prisma, pres, p.id, undefined, TODAY);
  const tasks = await prisma.task.findMany({ where: { project_id: p.id, deleted_at: null } });
  return { p, byKey: (k: string) => tasks.find((t) => t.template_key === k)! };
}

describe("요구 1·2·3: 행사일 미정·담당자 미추천·마감", () => {
  it("담당자는 추천하지 않는다(국서만) — 회의록에 이름이 있어도 assignee 비어 있음", () => {
    const rows = buildProposals({
      meetingId: "m", today: TODAY, params: DEFAULT_PARAMS, existing: [], members: [{ id: "u1", name: "장홍보" } as never],
      a2: { projects: [], tasks: [{ title: "카드뉴스", description: null, lead_department: "promotion", support_departments: [], template_key: null, assignee_hint: "장홍보", project_ref: null, due_date: "2026-11-20", inferred: false, inference_reason: null, evidence: [{ para: 1, quote: "x" }], confidence: 0.9 }] } as never,
    });
    expect((rows[0]!.payload as { assignee_ids: string[] }).assignee_ids).toEqual([]);
    expect(rows[0]!.payload).not.toHaveProperty("assignee_hint");
  });

  it("행사일 없는 사업 승인 → 임시 마감 없이 '행사일 미정' 알림, 나중에 행사일을 넣으면 표준 업무 마감 계산", async () => {
    const meeting = await prisma.meeting.create({ data: { term_id: pres.termId, title: "회의", meeting_date: new Date("2026-11-01T00:00:00Z"), meeting_type: "regular", source: "paste", status: "analyzed", uploaded_by: pres.userId } });
    const np = await prisma.proposal.create({ data: { term_id: pres.termId, source_type: "meeting", source_id: meeting.id, kind: "new_project", project_key: "k1", payload: { title: "송별회", category: "event", event_start: null, venue: null, expected_beneficiaries: null, funding: ["student_fee"], uses_external_vendor: false }, dedupe_key: "d1" } });
    const nt = await prisma.proposal.create({ data: { term_id: pres.termId, source_type: "meeting", source_id: meeting.id, kind: "new_task", project_key: "k1", payload: { title: "기획안 초안 작성", description: null, lead_department: "planning", support_departments: [], template_key: "PLN_DRAFT", assignee_ids: [], due_date: null, due_reason: null, due_feasible: true, acceptance_criteria: [], project_id: null }, dedupe_key: "d2" } });
    await decideProposals(prisma, pres, { approve: [{ id: np.id }, { id: nt.id }] });
    const project = await prisma.project.findFirstOrThrow({ where: { title: "송별회" } });
    const t = await prisma.task.findFirstOrThrow({ where: { project_id: project.id } });
    expect(t.due_date).toBeNull(); // 임시 마감 없음
    expect(await prisma.notification.count({ where: { user_id: pres.userId, type: "event_date_missing" } })).toBe(1);
    await moveProjectDates(prisma, pres, project.id, { event_start: "2026-12-20" });
    expect((await task(t.id)).due_date).not.toBeNull(); // 행사일을 넣으면 계산
  });
});

describe("요구 7: 결재 기획안 기준 재배정 승인 요청", () => {
  it("결재 → 이전 회의록 대기 제안 대체, 행사일·장소 변경·마감 재계산·기획안에만 있는 업무 추가 제안 → 승인하면 반영", async () => {
    const { p, byKey } = await eventProject("2026-12-09");
    const oldPending = await prisma.proposal.create({ data: { term_id: pres.termId, source_type: "meeting", kind: "deadline", target_id: byKey("PRO_MAKE").id, project_key: p.id, payload: { due_date: "2026-12-01" }, dedupe_key: "old" } });
    await savePlanVersion(prisma, storage, planner, p.id, { fields: FIELDS });
    const r = await approvePlan(prisma, pres, p.id);
    const out = await runPlanRebaseJob(prisma, mock, r.rebaseJobId);
    expect(out).toMatchObject({ outcome: "succeeded", usedAi: true });
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: oldPending.id } })).status).toBe("superseded");
    const props = await prisma.proposal.findMany({ where: { source_type: "plan", status: "pending" } });
    const up = props.find((x) => x.kind === "update_project")!;
    expect((up.payload as { changes: object }).changes).toEqual({ event_start: "2026-12-11", venue: "데모관 2층" });
    const dl = props.filter((x) => x.kind === "deadline");
    expect(dl.length).toBeGreaterThan(0);
    expect(props.some((x) => x.kind === "new_task" && (x.payload as { title: string }).title === "현장 리허설 준비")).toBe(true);
    expect(await prisma.notification.count({ where: { user_id: pres.userId, type: "review_pending", title: { contains: "결재 기획안 기준 재배정" } } })).toBe(1);

    await decideProposals(prisma, pres, { approve: props.map((x) => ({ id: x.id })) });
    const after = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.event_start?.toISOString().slice(0, 10)).toBe("2026-12-11");
    expect(after.venue).toBe("데모관 2층");
    const target = dl[0]!;
    expect((await task(target.target_id!)).due_date?.toISOString().slice(0, 10)).toBe((target.payload as { due_date: string }).due_date);
    expect(await prisma.task.count({ where: { project_id: p.id, title: "현장 리허설 준비", deleted_at: null } })).toBe(1);
  });

  it("업무 변경·취소 제안 승인 → 업무명·국서·마감 수정, 업무 취소 / AI 없어도 날짜·마감 제안은 올라감", async () => {
    const { p, byKey } = await eventProject("2026-12-09");
    await savePlanVersion(prisma, storage, planner, p.id, { fields: { ...FIELDS, event_date: "2026-12-09", venue: "데모관" } });
    const r = await approvePlan(prisma, pres, p.id);
    const custom: AiProvider = {
      name: "mock", available: true, model: "mock",
      complete: async (req: CompleteRequest) => {
        const tasks = (req.mockContext as { tasks: { ref: string; title: string }[] }).tasks;
        const ref = (t: string) => tasks.find((x) => x.title === t)!.ref;
        return {
          json: {
            add_tasks: [],
            update_tasks: [{ task_ref: ref(byKey("OPS_MANUAL").title), title: "집행 매뉴얼(2층 동선)", description: null, lead_department: "operations", support_departments: ["promotion"], due_date: null, reason: "기획안 장소 2층" }],
            cancel_tasks: [{ task_ref: ref(byKey("SEC_PARTNER_LIST").title), reason: "기획안에 제휴 없음" }],
            notes: "x",
          },
          model: "mock", inputTokens: 0, outputTokens: 0, costUsd: 0,
        };
      },
    };
    await runPlanRebaseJob(prisma, custom, r.rebaseJobId);
    const props = await prisma.proposal.findMany({ where: { source_type: "plan", status: "pending", kind: { in: ["update_task", "cancel"] } } });
    expect(props.map((x) => x.kind).sort()).toEqual(["cancel", "update_task"]);
    await decideProposals(prisma, pres, { approve: props.map((x) => ({ id: x.id })) });
    const ops = await prisma.task.findUniqueOrThrow({ where: { id: byKey("OPS_MANUAL").id }, include: { departments: { include: { department: true } } } });
    expect(ops.title).toBe("집행 매뉴얼(2층 동선)");
    expect(ops.departments.map((d) => `${d.role}:${d.department.code}`).sort()).toEqual(["lead:operations", "support:promotion"]);
    expect((await task(byKey("SEC_PARTNER_LIST").id)).status).toBe("cancelled");

    // AI 없이(provider null): 코드 제안만
    const { p: p2 } = await eventProject("2026-12-09");
    await savePlanVersion(prisma, storage, planner, p2.id, { fields: { ...FIELDS, event_date: "2026-12-16" } });
    const r2 = await approvePlan(prisma, pres, p2.id);
    const o2 = await runPlanRebaseJob(prisma, null, r2.rebaseJobId);
    expect(o2.usedAi).toBe(false);
    expect(await prisma.proposal.count({ where: { source_type: "plan", status: "pending", project_key: p2.id, kind: "deadline" } })).toBeGreaterThan(0);
  });

  it("결재 전 자료로 만든 레퍼런스는 '결재 전 기준' 표시 → 다시 만들면 결재본 기준 / 작업물 평가에 결재 기획안이 들어감", async () => {
    const { p, byKey } = await eventProject();
    const t = byKey("PRO_MAKE");
    await updateTask(prisma, pres, t.id, { assignee_ids: [promo.userId] });
    const a = await requestReferences(prisma, promo, t.id, {}, true);
    await runReferenceJob(prisma, mock, a.aiJobId);
    expect((await listReferences(prisma, promo, t.id, true)).requests[0]!.outdated).toBe(false); // 결재본이 아직 없음
    await savePlanVersion(prisma, storage, planner, p.id, { fields: FIELDS });
    await approvePlan(prisma, pres, p.id);
    let v = await listReferences(prisma, promo, t.id, true);
    expect(v.approvedPlan).toEqual({ versionNo: 1 });
    expect(v.requests[0]!.outdated).toBe(true);
    expect(v.items.some((i) => i.origin === "ai_generated" && i.outdated)).toBe(true);
    const b = await requestReferences(prisma, promo, t.id, { usePlan: true }, true);
    await runReferenceJob(prisma, mock, b.aiJobId);
    v = await listReferences(prisma, promo, t.id, true);
    expect(v.requests.find((r) => r.id === b.requestId)!.outdated).toBe(false);

    const seen: CompleteRequest[] = [];
    const spy: AiProvider = { name: "mock", available: true, model: "mock", complete: (r) => (seen.push(r), mock.complete(r)) };
    const up = await uploadDeliverable(prisma, storage, promo, { taskId: t.id, file: { name: "a.txt", bytes: new TextEncoder().encode("행사명 일시") } }, true);
    await runEvaluateJob(prisma, storage, spy, up.aiJobId!);
    expect(seen[0]!.documents!.map((d) => d.name)).toContain("기획안 v1 (결재본)");
    expect(seen[0]!.prompt).toContain("결재본 — 가장 중요한 기준");
  });
});

describe("요구 3(기획국): 레퍼런스 기획안", () => {
  it("기획국원이 의뢰 → (업무 없으면 '기획안 초안 작성' 생성) 참고 사이트 + 양식으로 가져올 수 있는 AI 기획안", async () => {
    const p = await createProject(prisma, pres, { title: "축제", event_start: "2026-12-18" });
    const r = await requestPlanReferences(prisma, planner, p.id, { instruction: "예산 적게" });
    await runReferenceJob(prisma, mock, r.aiJobId);
    const plan = await getPlan(prisma, planner, p.id);
    expect(plan.draftTaskId).toBe(r.taskId);
    expect(plan.aiPlanDrafts[0]!.plan).toMatchObject({ organizer: "기획국" });
    const refs = await listReferences(prisma, planner, r.taskId, true);
    expect(refs.items.filter((i) => i.origin === "ai_search").length).toBeGreaterThan(0);
    expect(refs.items.find((i) => i.planDraft)).toBeTruthy();
    await expect(requestPlanReferences(prisma, promo, p.id, {})).rejects.toMatchObject({ status: 403 });
  });
});

describe("요구 5: 사업 자동 완료·작업물 보관함·최종본·일괄 수정", () => {
  it("재정국 업무를 뺀 모든 업무가 100%면 '완료'로 이동, 다시 내려가면 '진행 중'", async () => {
    const p = await createProject(prisma, pres, { title: "행사" });
    const a = await createTask(prisma, pres, { title: "포스터", project_id: p.id, lead_department_id: dept.promotion! });
    const b = await createTask(prisma, pres, { title: "매뉴얼", project_id: p.id, lead_department_id: dept.operations! });
    await createTask(prisma, pres, { title: "결산", project_id: p.id, lead_department_id: dept.finance! }); // 재정국은 제외
    await setCompleted(prisma, pres, a.id, true);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).not.toBe("done");
    await setManualProgress(prisma, pres, b.id, { value: 100 });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("done");
    expect(await prisma.notification.count({ where: { type: "project_done" } })).toBeGreaterThan(0);
    await setCompleted(prisma, pres, a.id, false);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("in_progress");
  });

  it("작업물 보관함: 국서별 최종본(없으면 최신), 최종본 지정·이름·메모 수정", async () => {
    const p = await createProject(prisma, pres, { title: "행사" });
    const t = await createTask(prisma, pres, { title: "포스터", project_id: p.id, lead_department_id: dept.promotion!, assignee_ids: [promo.userId] });
    const v1 = await uploadDeliverable(prisma, storage, promo, { taskId: t.id, title: "포스터", file: { name: "p.pdf", bytes: new Uint8Array(readFileSync("tests/fixtures/minutes/minutes.pdf")) } }, false);
    const v2 = await uploadDeliverable(prisma, storage, promo, { taskId: t.id, deliverableId: v1.deliverableId, file: { name: "p2.pdf", bytes: new Uint8Array(readFileSync("tests/fixtures/minutes/minutes.pdf")) } }, false);
    let ar = await projectArchive(prisma, fin, p.id);
    expect(ar.groups[0]).toMatchObject({ code: "promotion" });
    expect(ar.groups[0]!.items[0]).toMatchObject({ versionNo: 2, isFinal: false });
    await updateDeliverable(prisma, promo, v1.deliverableId, { finalVersionId: v1.versionId, title: "최종 포스터", versionNote: { versionId: v2.versionId, note: "색 수정" } });
    ar = await projectArchive(prisma, fin, p.id);
    expect(ar.groups[0]!.items[0]).toMatchObject({ title: "최종 포스터", versionNo: 1, isFinal: true });
    await expect(updateDeliverable(prisma, fin, v1.deliverableId, { title: "x" })).rejects.toBeTruthy(); // 다른 국서 국원 불가
  });

  it("일괄 수정: 마감 지정·이동·담당자·완료·취소, 권한 없는 건 실패 목록으로", async () => {
    const t1 = await createTask(prisma, pres, { title: "A", lead_department_id: dept.promotion!, due_date: "2026-11-10" });
    const t2 = await createTask(prisma, pres, { title: "B", lead_department_id: dept.promotion!, due_date: "2026-11-12" });
    expect((await bulkUpdateTasks(prisma, pres, { ids: [t1.id, t2.id], action: "shift", days: 3 })).done).toBe(2);
    expect((await task(t1.id)).due_date?.toISOString().slice(0, 10)).toBe("2026-11-13");
    expect((await task(t2.id)).due_state).toBe("confirmed");
    await bulkUpdateTasks(prisma, pres, { ids: [t1.id, t2.id], action: "due", due_date: "2026-11-20" });
    expect((await task(t2.id)).due_date?.toISOString().slice(0, 10)).toBe("2026-11-20");
    await bulkUpdateTasks(prisma, pres, { ids: [t1.id, t2.id], action: "assign", assignee_ids: [promo.userId] });
    expect(await prisma.taskAssignee.count({ where: { user_id: promo.userId } })).toBe(2);
    const r = await bulkUpdateTasks(prisma, fin, { ids: [t1.id], action: "complete" });
    expect(r.failed).toHaveLength(1); // 재정국원은 남의 업무 완료 불가
    expect((await bulkUpdateTasks(prisma, promo, { ids: [t1.id, t2.id], action: "complete" })).done).toBe(2);
    await bulkUpdateTasks(prisma, pres, { ids: [t1.id], action: "uncomplete" });
    await bulkUpdateTasks(prisma, pres, { ids: [t1.id], action: "cancel" });
    expect((await task(t1.id)).status).toBe("cancelled");
  });
});
