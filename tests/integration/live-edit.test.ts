import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetAllTables } from "@/lib/setup/reset";
import { ensureBaseSetup } from "@/lib/setup/bootstrap";
import { createProject, deleteProject, listDeletedProjects, restoreProject } from "@/lib/services/projects";
import { applyStandardTemplate } from "@/lib/services/schedule";
import { createTask, deleteTask, listDeletedTasks, restoreTask, updateTask } from "@/lib/services/tasks";
import { decideProposals } from "@/lib/services/proposals";
import { approvePlan, revokePlanApproval, savePlanVersion } from "@/lib/services/plans";
import { addReference, listReferences, updateReference } from "@/lib/services/references";
import { requestRepropose } from "@/lib/services/analysis";
import { runProposeJob } from "@/lib/ai/agents";
import { MockProvider } from "@/lib/ai/provider";
import { MOCK_HANDLERS } from "@/lib/ai/mock";
import { loadReview } from "@/lib/review";
import type { Actor } from "@/lib/auth/can";
import type { Storage } from "@/lib/storage";

/**
 * 사용자 요구(2026-10-31): 모든 작업·현황을 수시로 삭제·수정, 연결된 것(대기 제안·선후관계·차단·사업 완료·진척도·캘린더·레퍼런스)이 함께 반영.
 */
class Mem implements Storage {
  readonly driver = "local" as const;
  f = new Map<string, Uint8Array>();
  async put(k: string, d: Uint8Array) { this.f.set(k, d); }
  async get(k: string) { return this.f.get(k) ?? null; }
  async delete(k: string) { this.f.delete(k); }
}
type A = Actor & { termId: string };
let pres: A, planner: A, promo: A, fin: A;
let dept: Record<string, string>;
const TODAY = "2026-10-31";
const FIELDS = {
  title: "간식", event_date: "2026-12-09", datetime: "12월 9일 12:00", venue: "데모관", budget: 400000, host: "학생회", organizer: "기획국",
  purpose: "응원", content: "배부", timetable: [], budget_scenarios: [],
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
});

async function chain() {
  const p = await createProject(prisma, pres, { title: "간식", event_start: "2026-12-09" });
  const plan = await createTask(prisma, pres, { title: "기획안", lead_department_id: dept.planning, project_id: p.id });
  const promoT = await createTask(prisma, pres, { title: "홍보물", lead_department_id: dept.promotion, project_id: p.id, dependencies: [{ depends_on_task_id: plan.id, type: "finish_to_start" }] });
  return { p, plan, promoT };
}

describe("업무 삭제·되살리기", () => {
  it("삭제: 후속 업무 차단 해제 + 이 업무 대상 대기 제안 정리(검토 화면에서 빠짐) / 되살리기: 선후관계·차단 복원", async () => {
    const { p, plan, promoT } = await chain();
    expect((await task(promoT.id)).status).toBe("blocked");
    const prop = await prisma.proposal.create({ data: { term_id: pres.termId, source_type: "meeting", kind: "deadline", target_id: plan.id, project_key: p.id, payload: { due_date: "2026-11-20", requested_by: pres.userId }, dedupe_key: "d" } });
    const r = await deleteTask(prisma, pres, plan.id);
    expect(r).toMatchObject({ projectId: p.id, supersededProposals: 1 });
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: prop.id } })).status).toBe("superseded");
    expect((await task(promoT.id)).status).toBe("todo"); // 차단 해제
    expect((await loadReview(pres.termId)).length).toBe(0);
    expect((await listDeletedTasks(prisma, pres, { projectId: p.id })).map((t) => t.title)).toEqual(["기획안"]);

    await restoreTask(prisma, pres, plan.id);
    expect((await task(plan.id)).deleted_at).toBeNull();
    expect(await prisma.taskDependency.count({ where: { task_id: promoT.id, depends_on_task_id: plan.id } })).toBe(1);
    expect((await task(promoT.id)).status).toBe("blocked"); // 다시 차단
    expect(await listDeletedTasks(prisma, pres, { projectId: p.id })).toHaveLength(0);
    await expect(restoreTask(prisma, pres, plan.id)).rejects.toThrow(/찾을 수 없습니다/);
    await expect(deleteTask(prisma, promo, plan.id)).rejects.toThrow();
  });

  it("승인 중 대상 업무가 이미 삭제된 제안은 건너뛰고 나머지는 승인", async () => {
    const { p, plan, promoT } = await chain();
    const a = await prisma.proposal.create({ data: { term_id: pres.termId, source_type: "meeting", kind: "update_task", target_id: plan.id, project_key: p.id, payload: { title: "기획안", changes: { due_date: "2026-11-20" } }, dedupe_key: "a" } });
    const b = await prisma.proposal.create({ data: { term_id: pres.termId, source_type: "meeting", kind: "update_task", target_id: promoT.id, project_key: p.id, payload: { title: "홍보물", changes: { due_date: "2026-11-27" } }, dedupe_key: "b" } });
    await prisma.task.update({ where: { id: plan.id }, data: { deleted_at: new Date() } }); // 다른 경로로 삭제된 상황
    const r = await decideProposals(prisma, pres, { approve: [{ id: a.id }, { id: b.id }] });
    expect(r.skipped).toBe(1);
    expect((await task(promoT.id)).due_date?.toISOString().slice(0, 10)).toBe("2026-11-27");
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("superseded");
  });
});

describe("사업 삭제·되살리기", () => {
  it("사업과 업무를 함께 삭제, 대기 제안 정리, 다른 사업의 후속 업무 차단 해제 / 되살리면 업무도 함께", async () => {
    const { p, plan } = await chain();
    const other = await createProject(prisma, pres, { title: "다른 사업", event_start: "2026-12-20" });
    const outside = await createTask(prisma, pres, { title: "바깥 업무", lead_department_id: dept.finance, project_id: other.id, dependencies: [{ depends_on_task_id: plan.id, type: "finish_to_start" }] });
    expect((await task(outside.id)).status).toBe("blocked");
    const np = await prisma.proposal.create({ data: { term_id: pres.termId, source_type: "meeting", kind: "new_task", project_key: p.id, target_id: p.id, payload: { title: "x" }, dedupe_key: "n" } });
    const r = await deleteProject(prisma, pres, p.id);
    expect(r).toMatchObject({ deletedTasks: 2, supersededProposals: 1 });
    expect(await prisma.task.count({ where: { project_id: p.id, deleted_at: null } })).toBe(0);
    expect((await task(outside.id)).status).toBe("todo");
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: np.id } })).status).toBe("superseded");
    expect((await listDeletedProjects(prisma, pres)).map((x) => x.title)).toEqual(["간식"]);
    await expect(deleteProject(prisma, promo, other.id)).rejects.toThrow();

    const back = await restoreProject(prisma, pres, p.id);
    expect(back.restoredTasks).toBe(2);
    expect(await prisma.task.count({ where: { project_id: p.id, deleted_at: null } })).toBe(2);
    expect((await task(outside.id)).status).toBe("blocked"); // 선행 업무가 돌아와 다시 차단
  });
});

describe("기획안 결재 취소", () => {
  it("가장 최근 결재를 되돌린다: 기획안 업무 다시 진행 중, 후속 업무 다시 결재 대기, 결재본 기준 재배정 대기 제안 정리", async () => {
    const p = await createProject(prisma, pres, { title: "간식", event_start: "2026-12-09", funding: [{ source: "student_fee", amount_planned: 400000 }] });
    await applyStandardTemplate(prisma, pres, p.id, ["PLN_DRAFT", "PLN_APPROVAL", "PRO_TIER", "PRO_MAKE"], TODAY);
    const byKey = async (k: string) => prisma.task.findFirstOrThrow({ where: { project_id: p.id, template_key: k } });
    await savePlanVersion(prisma, new Mem(), planner, p.id, { fields: FIELDS });
    const a = await approvePlan(prisma, pres, p.id);
    expect((await byKey("PLN_DRAFT")).is_completed).toBe(true);
    expect((await byKey("PRO_TIER")).status).toBe("todo");
    const version = await prisma.planVersion.findFirstOrThrow({ where: { approved_at: { not: null } } });
    const rebase = await prisma.proposal.create({ data: { term_id: pres.termId, source_type: "plan", source_id: version.id, kind: "deadline", target_id: (await byKey("PRO_MAKE")).id, project_key: p.id, payload: { due_date: "2026-11-27", requested_by: pres.userId }, dedupe_key: "r" } });

    const r = await revokePlanApproval(prisma, pres, p.id);
    expect(r).toMatchObject({ versionNo: 1, supersededProposals: 1 });
    expect((await byKey("PLN_DRAFT")).is_completed).toBe(false);
    expect((await byKey("PRO_TIER")).status).toBe("blocked");
    expect((await prisma.planVersion.findUniqueOrThrow({ where: { id: version.id } })).approved_at).toBeNull();
    expect((await prisma.plan.findFirstOrThrow({ where: { project_id: p.id } })).status).toBe("draft");
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: rebase.id } })).status).toBe("superseded");
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: a.rebaseJobId } })).status).toBe("failed");
    await expect(revokePlanApproval(prisma, pres, p.id)).rejects.toThrow(/결재된 기획안이 없습니다/);
    await expect(revokePlanApproval(prisma, planner, p.id)).rejects.toThrow();
  });
});

describe("레퍼런스 수정", () => {
  it("같은 국서·추가한 사람·국장은 제목·요약·링크를 고칠 수 있고, 다른 국서 국원은 불가", async () => {
    const p = await createProject(prisma, pres, { title: "간식", event_start: "2026-12-09" });
    const t = await createTask(prisma, pres, { title: "홍보물", lead_department_id: dept.promotion, project_id: p.id });
    const ref = await addReference(prisma, new Mem(), promo, t.id, { url: "https://a.example", title: "예전 제목" });
    await updateReference(prisma, promo, ref.id, { title: "새 제목", summary: "포스터 배치 참고", url: "https://b.example" });
    const list = await listReferences(prisma, promo, t.id, true);
    expect(list.items[0]).toMatchObject({ title: "새 제목", summary: "포스터 배치 참고", url: "https://b.example", canEdit: true });
    await expect(updateReference(prisma, fin, ref.id, { title: "x" })).rejects.toMatchObject({ status: 403 });
    await expect(updateReference(prisma, promo, ref.id, { url: "javascript:alert(1)" })).rejects.toThrow();
    await updateReference(prisma, pres, ref.id, { title: "회장 수정" });
    expect((await prisma.referenceItem.findUniqueOrThrow({ where: { id: ref.id } })).title).toBe("회장 수정");
  });
});

describe("고친 정리본으로 제안 다시 만들기", () => {
  it("정리본을 고치면 그 정리본으로 업무 제안만 다시(A2) — 이전 대기 제안은 대체", async () => {
    const m = await prisma.meeting.create({ data: { term_id: pres.termId, title: "회의", meeting_date: new Date(`${TODAY}T00:00:00Z`), meeting_type: "regular", source: "paste", status: "analyzed", uploaded_by: pres.userId, files: { create: { original_name: "a.txt", mime: "text/plain", extracted_text: "[1] 회의\n[2] 홍보국 카드뉴스 제작", extraction_method: "paste" } } } });
    const summary = { agenda: [], action_items: [{ who: "홍보국", department: "promotion", what: "카드뉴스 제작", due_text: null, due_date: null, date_confidence: "none", para: 2, quote: "홍보국 카드뉴스 제작" }], events: [], budget: [], schedule: [] };
    await prisma.meetingAnalysis.create({ data: { meeting_id: m.id, version: 1, summary, model: "user-edit", prompt_version: "a1-v2" } as never });
    const old = await prisma.proposal.create({ data: { term_id: pres.termId, source_type: "meeting", source_id: m.id, kind: "new_task", payload: { title: "예전 제안" }, dedupe_key: "old" } });
    const r = await requestRepropose(prisma, pres, m.id, true);
    await runProposeJob(prisma, new MockProvider(MOCK_HANDLERS), r.aiJobId);
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("superseded");
    const fresh = await prisma.proposal.findMany({ where: { source_id: m.id, status: "pending" } });
    expect(fresh.map((x) => (x.payload as { title: string }).title)).toContain("카드뉴스 제작");
    await expect(requestRepropose(prisma, promo, m.id, true)).rejects.toThrow();
    await expect(requestRepropose(prisma, pres, m.id, false)).rejects.toThrow(/AI/);
  });
});

describe("업무 수정 → 연결 반영", () => {
  it("국서 공간에서 마감을 바꾸면 검토 화면의 마감 변경 요청에 '지금 마감'이 바로 반영", async () => {
    const { p, plan } = await chain();
    await prisma.proposal.create({ data: { term_id: pres.termId, source_type: "meeting", kind: "deadline", target_id: plan.id, project_key: p.id, payload: { due_date: "2026-11-20", requested_by: pres.userId }, before_snapshot: { due_date: null }, dedupe_key: "d" } });
    await updateTask(prisma, pres, plan.id, { due_date: "2026-11-18" });
    const item = (await loadReview(pres.termId)).flatMap((g) => g.projects.flatMap((x) => x.items)).find((i) => i.kind === "deadline")!;
    expect(item.currentDue).toBe("2026-11-18");
  });
});
