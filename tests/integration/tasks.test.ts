import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetAllTables } from "@/lib/setup/reset";
import { ensureBaseSetup } from "@/lib/setup/bootstrap";
import { cancelProject, createProject, setProjectStatus, updateProject } from "@/lib/services/projects";
import {
  addDependency, createTask, deleteTask, getTaskDetail, removeDependency, setAiProgress, setCompleted, setManualProgress, updateTask,
} from "@/lib/services/tasks";
import { ForbiddenError, type Actor } from "@/lib/auth/can";
import { ServiceError } from "@/lib/services/invitations";

type A = Actor & { termId: string };
let pres: A;
let member: A; // 홍보국원
let otherMember: A; // 사무국원
let dept: Record<string, string>;

const eff = async (id: string) => (await prisma.$queryRaw<{ e: number }[]>`SELECT effective_progress AS e FROM task_progress WHERE task_id = ${id}::uuid`)[0]!.e;
const task = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });

async function user(role: "president" | "member", code?: string): Promise<A> {
  const term = await ensureBaseSetup(prisma);
  const u = await prisma.user.create({ data: { email: `${role}-${Math.random()}@t.test`, display_name: role, status: "active" } });
  await prisma.membership.create({ data: { user_id: u.id, term_id: term.id, role, department_id: code ? dept[code] : null } });
  return { userId: u.id, role, departmentId: code ? dept[code]! : null, departmentCode: code ?? null, termId: term.id };
}

beforeAll(() => {
  if (!/kgb_test/.test(process.env.DATABASE_URL ?? "")) throw new Error("kgb_test 전용");
});
afterAll(async () => prisma.$disconnect());
beforeEach(async () => {
  await resetAllTables(prisma);
  // 기수 날짜를 고정(테스트 실행일과 무관하게 2025-12-01 ~ 2026-11-30)
  const term = await ensureBaseSetup(prisma, new Date("2026-10-31T00:00:00Z"));
  dept = Object.fromEntries((await prisma.department.findMany({ where: { term_id: term.id } })).map((d) => [d.code, d.id]));
  pres = await user("president");
  member = await user("member", "promotion");
  otherMember = await user("member", "secretariat");
});

async function project(title = "종강 간식 행사") {
  return createProject(prisma, pres, { title, event_start: "2026-12-10", venue: "데모관", expected_beneficiaries: 150, funding: [{ source: "student_fee", amount_planned: 500000 }] });
}

describe("사업 CRUD", () => {
  it("생성 시 분기 귀속 계산(행사 시작일 기준), 재원 저장, 감사 로그", async () => {
    const inTerm = await createProject(prisma, pres, { title: "가을 행사", event_start: "2026-11-20" });
    expect(inTerm.quarter).toBe(4); // 기본 기수(2025-12-01~2026-11-30)의 4분기
    const p = await project();
    expect(p.quarter).toBeNull(); // 기수 기간 밖 행사일은 분기 없음(설정에서 기수 날짜 조정 — Phase 4)
    expect(p.event_end?.toISOString().slice(0, 10)).toBe("2026-12-10"); // 종료일 미입력 시 시작일
    expect(await prisma.projectFundingSource.count({ where: { project_id: p.id } })).toBe(1);
    expect(await prisma.activityLog.count({ where: { entity_id: p.id, action: "project.create" } })).toBe(1);
  });
  it("검증: 종료일 < 시작일, 같은 재원 중복, 국원 생성 불가", async () => {
    await expect(createProject(prisma, pres, { title: "x", event_start: "2026-12-10", event_end: "2026-12-01" })).rejects.toThrow(/종료일/);
    await expect(createProject(prisma, pres, { title: "x", funding: [{ source: "school", amount_planned: 1 }, { source: "school", amount_planned: 2 }] })).rejects.toThrow(/같은 재원/);
    await expect(createProject(prisma, member, { title: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("수정: 재원 교체, 상태 변경", async () => {
    const p = await project();
    await updateProject(prisma, pres, p.id, { title: "종강 간식 행사(수정)", event_start: "2026-12-11", funding: [{ source: "school", amount_planned: 1000000 }] });
    const f = await prisma.projectFundingSource.findMany({ where: { project_id: p.id } });
    expect(f.map((x) => x.source)).toEqual(["school"]);
    await setProjectStatus(prisma, pres, p.id, { status: "in_progress" });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("in_progress");
  });
});

describe("T4 국서 배정 · T11 협업 동기화", () => {
  it("업무당 lead 1개, 협업 업무는 주관·협조 국서 모두에 하나의 레코드로 연결", async () => {
    const p = await project();
    const t = await createTask(prisma, pres, {
      project_id: p.id, title: "카드뉴스 제작", lead_department_id: dept.promotion, support_department_ids: [dept.secretariat], assignee_ids: [member.userId],
    });
    const links = await prisma.taskDepartment.findMany({ where: { task_id: t.id } });
    expect(links.filter((l) => l.role === "lead")).toHaveLength(1);
    // 국서 공간 조회 조건(해당 국서 연결)으로 두 국서 모두에서 같은 업무가 조회됨
    for (const code of ["promotion", "secretariat"]) {
      const rows = await prisma.task.findMany({ where: { departments: { some: { department_id: dept[code] } } } });
      expect(rows.map((r) => r.id)).toEqual([t.id]);
    }
    // 홍보국 담당자가 진척 변경 → 사무국 화면 재조회 시 같은 값(복제 없음)
    await setManualProgress(prisma, member, t.id, { value: 40 });
    const fromSecretariat = await prisma.task.findFirstOrThrow({ where: { departments: { some: { department_id: dept.secretariat } } } });
    expect(fromSecretariat.manual_progress).toBe(40);
    expect(await eff(t.id)).toBe(40);
  });
  it("주관 국서를 협조로 중복 지정 불가, 주관 국서 변경 시에도 lead 1개 유지", async () => {
    await expect(createTask(prisma, pres, { title: "x", lead_department_id: dept.promotion, support_department_ids: [dept.promotion] })).rejects.toThrow(/주관 국서/);
    const t = await createTask(prisma, pres, { title: "x", lead_department_id: dept.promotion, support_department_ids: [dept.planning] });
    await updateTask(prisma, pres, t.id, { lead_department_id: dept.planning, support_department_ids: [dept.promotion] });
    const links = await prisma.taskDepartment.findMany({ where: { task_id: t.id }, orderBy: { role: "asc" } });
    expect(links.map((l) => [l.role, l.department_id])).toEqual([["lead", dept.planning], ["support", dept.promotion]]);
  });
  it("담당자는 이 기수 회원만", async () => {
    const outsider = await prisma.user.create({ data: { email: "o@t.test", display_name: "외부" } });
    await expect(createTask(prisma, pres, { title: "x", lead_department_id: dept.promotion, assignee_ids: [outsider.id] })).rejects.toThrow(/회원/);
  });
});

describe("T14 수동 진척도 · T15 완료 체크 (AI 값은 수동 주입)", () => {
  it("T14: 수동 40% → effective 40, 이력, 이후 AI 재평가가 수동 값을 덮어쓰지 않음, 'AI 평가로 되돌리기'", async () => {
    const t = await createTask(prisma, pres, { title: "카드뉴스", lead_department_id: dept.promotion, assignee_ids: [member.userId] });
    await setAiProgress(prisma, pres.termId, t.id, 60);
    expect((await task(t.id)).status).toBe("in_progress"); // 진척이 생기면 진행 중
    await setManualProgress(prisma, member, t.id, { value: 40 });
    expect(await eff(t.id)).toBe(40);
    await setAiProgress(prisma, pres.termId, t.id, 80);
    expect(await task(t.id)).toMatchObject({ manual_progress: 40, ai_progress: 80 });
    expect(await eff(t.id)).toBe(40);
    await setManualProgress(prisma, member, t.id, { value: null });
    expect(await eff(t.id)).toBe(80);
    const h = await prisma.progressHistory.findMany({ where: { task_id: t.id }, orderBy: { created_at: "asc" } });
    expect(h.map((x) => `${x.field}:${x.old_value}->${x.new_value}`)).toEqual(["ai:null->60", "manual:null->40", "ai:60->80", "manual:40->null"]);
    expect(h[3]!.reason).toBe("AI 평가로 되돌리기");
  });

  it("T15: AI 72% 에서 완료 → 100%, AI 72% 이력 보존, 해제 시 72% 복귀, 후속 차단 해제", async () => {
    const a = await createTask(prisma, pres, { title: "기획안 결재", lead_department_id: dept.planning });
    const b = await createTask(prisma, pres, { title: "카드뉴스", lead_department_id: dept.promotion, dependencies: [{ depends_on_task_id: a.id, type: "approval_required" }] });
    expect((await task(b.id)).status).toBe("blocked");
    await setAiProgress(prisma, pres.termId, a.id, 72);
    await setCompleted(prisma, pres, a.id, true);
    expect(await eff(a.id)).toBe(100);
    expect(await task(a.id)).toMatchObject({ ai_progress: 72, status: "done", is_completed: true });
    const h = await prisma.progressHistory.findFirstOrThrow({ where: { task_id: a.id, field: "completed" } });
    expect(h.reason).toBe("AI 평가 72% / 사용자 완료 확정");
    expect((await task(b.id)).status).toBe("todo"); // 후속 차단 해제

    await setCompleted(prisma, pres, a.id, false);
    expect(await eff(a.id)).toBe(72);
    expect((await task(a.id)).status).toBe("in_progress");
    expect((await task(b.id)).status).toBe("blocked"); // 다시 결재 대기
  });

  it("권한: 국원은 자기 담당 업무만 진척·완료, 타인 업무 403 / 차단 업무는 완료 불가", async () => {
    const mine = await createTask(prisma, pres, { title: "내 업무", lead_department_id: dept.promotion, assignee_ids: [member.userId] });
    const others = await createTask(prisma, pres, { title: "남 업무", lead_department_id: dept.promotion, assignee_ids: [otherMember.userId] });
    await expect(setCompleted(prisma, member, mine.id, true)).resolves.toBeTruthy();
    await expect(setCompleted(prisma, member, others.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setManualProgress(prisma, member, others.id, { value: 10 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateTask(prisma, member, mine.id, { title: "바꿈" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateTask(prisma, member, mine.id, { due_date: "2026-12-01" })).rejects.toBeInstanceOf(ForbiddenError);
    const blocked = await createTask(prisma, pres, { title: "후속", lead_department_id: dept.promotion, dependencies: [{ depends_on_task_id: others.id, type: "finish_to_start" }] });
    expect((await task(blocked.id)).status).toBe("blocked");
    await expect(setCompleted(prisma, pres, blocked.id, true)).rejects.toThrow(/차단/);
    await expect(updateTask(prisma, pres, blocked.id, { status: "in_progress" })).rejects.toThrow(/차단/);
    await expect(setManualProgress(prisma, member, mine.id, { value: 101 })).rejects.toBeInstanceOf(ServiceError);
  });

  it("담당 국원은 상태(진행 중·검토)만 바꿀 수 있고 취소는 불가", async () => {
    const mine = await createTask(prisma, pres, { title: "내 업무", lead_department_id: dept.promotion, assignee_ids: [member.userId] });
    await updateTask(prisma, member, mine.id, { status: "review" });
    expect((await task(mine.id)).status).toBe("review");
    await expect(updateTask(prisma, member, mine.id, { status: "cancelled" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("의존관계 (4-3, D7)", () => {
  it("순환 금지(직접·간접), 중복 금지, 삭제 시 상태 재계산", async () => {
    const a = await createTask(prisma, pres, { title: "A", lead_department_id: dept.planning });
    const b = await createTask(prisma, pres, { title: "B", lead_department_id: dept.planning, dependencies: [{ depends_on_task_id: a.id, type: "finish_to_start" }] });
    const c = await createTask(prisma, pres, { title: "C", lead_department_id: dept.planning });
    await addDependency(prisma, pres, c.id, { depends_on_task_id: b.id, type: "finish_to_start" });
    await expect(addDependency(prisma, pres, a.id, { depends_on_task_id: c.id, type: "finish_to_start" })).rejects.toThrow(/순환/);
    await expect(addDependency(prisma, pres, a.id, { depends_on_task_id: a.id, type: "finish_to_start" })).rejects.toThrow(/순환/);
    await expect(addDependency(prisma, pres, c.id, { depends_on_task_id: b.id, type: "draft_ok" })).rejects.toThrow(/이미/);
    expect((await task(c.id)).status).toBe("blocked");
    const dep = await prisma.taskDependency.findFirstOrThrow({ where: { task_id: c.id } });
    await removeDependency(prisma, pres, c.id, dep.id);
    expect((await task(c.id)).status).toBe("todo");
  });

  it("초안 기반 선착수(D7): 국장 허용 시 결재 전이라도 초안이 있으면 착수 + 표시", async () => {
    const plan = await createTask(prisma, pres, { title: "기획안 결재", lead_department_id: dept.planning });
    const promo = await createTask(prisma, pres, { title: "홍보물", lead_department_id: dept.promotion, dependencies: [{ depends_on_task_id: plan.id, type: "approval_required" }] });
    await setAiProgress(prisma, pres.termId, plan.id, 30); // 초안 진행 중
    expect((await task(promo.id)).status).toBe("blocked");
    await updateTask(prisma, pres, promo.id, { allow_draft_start: true });
    expect(await task(promo.id)).toMatchObject({ status: "todo", started_on_draft_plan: true });
  });

  it("draft_ok: 선행 착수 시 해제", async () => {
    const draft = await createTask(prisma, pres, { title: "기획안 초안", lead_department_id: dept.planning });
    const partners = await createTask(prisma, pres, { title: "제휴 후보", lead_department_id: dept.secretariat, dependencies: [{ depends_on_task_id: draft.id, type: "draft_ok" }] });
    expect((await task(partners.id)).status).toBe("blocked");
    await updateTask(prisma, pres, draft.id, { status: "in_progress" });
    expect((await task(partners.id)).status).toBe("todo");
  });

  it("선행 업무 삭제 시 후속 차단 해제", async () => {
    const a = await createTask(prisma, pres, { title: "A", lead_department_id: dept.planning });
    const b = await createTask(prisma, pres, { title: "B", lead_department_id: dept.planning, dependencies: [{ depends_on_task_id: a.id, type: "finish_to_start" }] });
    await deleteTask(prisma, pres, a.id);
    expect((await task(b.id)).status).toBe("todo");
    await expect(getTaskDetail(prisma, pres, a.id)).rejects.toThrow(/찾을 수 없/);
  });
});

describe("T17 사업 취소", () => {
  it("미완료 업무 cancelled, 완료 업무·증빙 보존, 다른 사업의 후속 업무 차단 해제", async () => {
    const p = await project();
    const done = await createTask(prisma, pres, { project_id: p.id, title: "완료된 업무", lead_department_id: dept.planning });
    await setCompleted(prisma, pres, done.id, true);
    const open = await createTask(prisma, pres, { project_id: p.id, title: "미완료 업무", lead_department_id: dept.promotion });
    const evidence = await prisma.evidenceItem.create({ data: { project_id: p.id, storage_key: "evidence/2026/12/0192f0a0-0000-7000-8000-000000000001", uploaded_by: pres.userId } });
    const other = await project("다른 사업");
    const follower = await createTask(prisma, pres, { project_id: other.id, title: "다른 사업 후속", lead_department_id: dept.operations, dependencies: [{ depends_on_task_id: open.id, type: "finish_to_start" }] });
    expect((await task(follower.id)).status).toBe("blocked");

    expect(await cancelProject(prisma, pres, p.id)).toEqual({ cancelledTasks: 1 });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("cancelled");
    expect((await task(open.id)).status).toBe("cancelled");
    expect(await task(done.id)).toMatchObject({ status: "done", is_completed: true });
    expect(await prisma.evidenceItem.findUnique({ where: { id: evidence.id } })).not.toBeNull();
    expect((await task(follower.id)).status).toBe("todo");
    await expect(cancelProject(prisma, pres, p.id)).rejects.toThrow(/이미 취소/);
    await expect(createTask(prisma, pres, { project_id: p.id, title: "x", lead_department_id: dept.planning })).rejects.toThrow(/취소된 사업/);
    await expect(updateProject(prisma, pres, p.id, { title: "y" })).rejects.toThrow(/취소된/);
  });
});

describe("업무 상세(드로어)", () => {
  it("차단 사유·이력·권한 플래그", async () => {
    const a = await createTask(prisma, pres, { title: "기획안 결재", lead_department_id: dept.planning });
    const b = await createTask(prisma, pres, { title: "홍보물", lead_department_id: dept.promotion, assignee_ids: [member.userId], dependencies: [{ depends_on_task_id: a.id, type: "approval_required" }] });
    await updateTask(prisma, pres, b.id, { due_date: "2026-12-01" });
    const d = await getTaskDetail(prisma, member, b.id);
    expect(d.readiness.reasons).toEqual(["'기획안 결재' 결재 대기"]);
    expect(d.permissions).toMatchObject({ edit: false, complete: true, progress: true });
    expect(d.history.map((h) => (h.kind === "activity" ? h.action : h.field))).toEqual(expect.arrayContaining(["task.create", "task.update", "task.auto_status"]));
    expect(d.task.due_state).toBe("confirmed");
  });
});
