import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetAllTables } from "@/lib/setup/reset";
import { ensureBaseSetup } from "@/lib/setup/bootstrap";
import { createProject, moveProjectDates, updateProject } from "@/lib/services/projects";
import { setCompleted, updateTask } from "@/lib/services/tasks";
import { applyStandardTemplate, getProjectSchedule, recalcAll } from "@/lib/services/schedule";
import { previewQuarters, updateRuleSettings, updateTerm } from "@/lib/services/settings";
import { loadRuleParams } from "@/lib/rule-params";
import { ForbiddenError, type Actor } from "@/lib/auth/can";

/** Phase 4: 규칙 엔진 ↔ DB (T5, T6, T8, T10, T16). "오늘"은 2026-10-31 로 고정 */
type A = Actor & { termId: string };
let pres: A;
const TODAY = "2026-10-31";

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
  const u = await prisma.user.create({ data: { email: "p@t.test", display_name: "회장", status: "active" } });
  await prisma.membership.create({ data: { user_id: u.id, term_id: term.id, role: "president" } });
  pres = { userId: u.id, role: "president", departmentId: null, departmentCode: null, termId: term.id };
});

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
async function tasksByKey(projectId: string) {
  const rows = await prisma.task.findMany({ where: { project_id: projectId, deleted_at: null } });
  return Object.fromEntries(rows.map((r) => [r.template_key!, r]));
}

describe("T5 교비 + 외부업체 표준 업무", () => {
  it("행정실 송부 11/19 마일스톤, 업체 확정 11/12, 기획안 결재 11/05 — 제안 마감·근거 저장", async () => {
    const p = await createProject(prisma, pres, { title: "종강 행사", event_start: "2026-12-10", uses_external_vendor: true, funding: [{ source: "school", amount_planned: 1000000 }] });
    const r = await applyStandardTemplate(prisma, pres, p.id);
    expect(r.created).toBe(15); // 16개 중 FIN_EVIDENCE(학생회비 전용) 제외
    const t = await tasksByKey(p.id);
    expect(day(t.VENDOR_CONFIRM!.due_date)).toBe("2026-11-12");
    expect(day(t.PLN_APPROVAL!.due_date)).toBe("2026-11-05");
    expect(t.PLN_APPROVAL!.due_state).toBe("proposed");
    expect(t.VENDOR_CONFIRM!.due_reason).toContain("행정실 송부(11/19) 7일 전");
    const ms = await prisma.scheduleEvent.findFirstOrThrow({ where: { project_id: p.id, rule_key: "SCHOOL_SUBMIT" } });
    expect(day(ms.start)).toBe("2026-11-19");
    // 의존관계·차단 계산
    const depCount = await prisma.taskDependency.count({ where: { task: { project_id: p.id } } });
    expect(depCount).toBeGreaterThan(10);
    expect(t.FIN_BUDGET_RANGE!.status).toBe("todo");
    expect((await tasksByKey(p.id)).PLN_APPROVAL!.status).toBe("blocked");
    // 주관/협조 국서
    const draftDepts = await prisma.taskDepartment.findMany({ where: { task_id: t.PLN_DRAFT!.id }, include: { department: true } });
    expect(draftDepts.map((d) => `${d.role}:${d.department.code}`).sort()).toEqual(["lead:planning", "support:finance"]);
    // 다시 만들면 새로 만들 것이 없음
    await expect(applyStandardTemplate(prisma, pres, p.id)).rejects.toThrow(/새로 만들 표준 업무가 없습니다/);
  });
  it("일부만 만들고 나중에 나머지를 만들어도 의존관계가 이어진다", async () => {
    const p = await createProject(prisma, pres, { title: "x", event_start: "2026-12-10", funding: [{ source: "student_fee", amount_planned: 0 }] });
    await applyStandardTemplate(prisma, pres, p.id, ["PRO_MAKE", "PRO_PUBLISH"]);
    await applyStandardTemplate(prisma, pres, p.id);
    const t = await tasksByKey(p.id);
    const deps = await prisma.taskDependency.findMany({ where: { task_id: t.PRO_MAKE!.id } });
    expect(deps.map((d) => d.depends_on_task_id).sort()).toEqual([t.PLN_APPROVAL!.id, t.PRO_TIER!.id].sort());
  });
  it("행사일 없거나 국원이면 거부", async () => {
    const p = await createProject(prisma, pres, { title: "x" });
    await expect(applyStandardTemplate(prisma, pres, p.id)).rejects.toThrow(/행사일/);
    await expect(applyStandardTemplate(prisma, { ...pres, role: "member" }, p.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("T6 마감 불가", () => {
  it("과거 날짜 미생성 + 불가 표시 + 대안(학생회비 전환·연기 최단일)", async () => {
    const p = await createProject(prisma, pres, { title: "급한 행사", event_start: "2026-11-10", funding: [{ source: "school", amount_planned: 0 }] });
    const r = await applyStandardTemplate(prisma, pres, p.id);
    expect(r.feasible).toBe(false);
    const rows = await prisma.task.findMany({ where: { project_id: p.id } });
    for (const x of rows) if (x.due_date) expect(day(x.due_date)! >= TODAY).toBe(true);
    expect(rows.filter((x) => x.due_date === null).length).toBeGreaterThan(0);
    expect(rows.some((x) => !x.due_feasible)).toBe(true);
    expect(await prisma.scheduleEvent.count({ where: { project_id: p.id } })).toBe(0); // 지난 송부일 마일스톤 미생성
    const view = await getProjectSchedule(prisma, pres, p.id);
    expect(view.result!.feasible).toBe(false);
    expect(view.result!.alternatives).toMatchObject({ toStudentFee: false, earliestEventDate: "2026-12-01" });
  });
});

describe("T16 일정 변경", () => {
  it("행사일 변경 → 제안 마감만 재계산, 확정 마감 유지 + 충돌 경고, 일괄 재계산으로 해소", async () => {
    const p = await createProject(prisma, pres, { title: "행사", event_start: "2026-12-10", funding: [{ source: "student_fee", amount_planned: 0 }] });
    await applyStandardTemplate(prisma, pres, p.id);
    let t = await tasksByKey(p.id);
    expect(day(t.OPS_MANUAL!.due_date)).toBe("2026-12-03");
    await updateTask(prisma, pres, t.PRO_PUBLISH!.id, { due_date: "2026-12-03" }); // 확정
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.PRO_PUBLISH!.id } })).due_state).toBe("confirmed");

    await updateProject(prisma, pres, p.id, { title: "행사", event_start: "2026-12-01", funding: [{ source: "student_fee", amount_planned: 0 }] });
    t = await tasksByKey(p.id);
    expect(day(t.OPS_MANUAL!.due_date)).toBe("2026-11-24"); // 제안 → 재계산
    expect(t.OPS_MANUAL!.due_state).toBe("proposed");
    expect(day(t.PRO_PUBLISH!.due_date)).toBe("2026-12-03"); // 확정 → 유지
    expect(day(t.OPS_EXECUTE!.due_date)).toBe("2026-12-01");
    const view = await getProjectSchedule(prisma, pres, p.id);
    expect(view.conflicts).toEqual([{ key: "PRO_PUBLISH", title: "홍보물 게시·배포", confirmed: "2026-12-03", latest: "2026-11-24" }]);

    const r = await recalcAll(prisma, pres, p.id);
    expect(r.updated).toBeGreaterThan(0);
    t = await tasksByKey(p.id);
    expect(t.PRO_PUBLISH).toMatchObject({ due_state: "proposed" });
    expect(day(t.PRO_PUBLISH!.due_date)).toBe("2026-11-24");
    expect((await getProjectSchedule(prisma, pres, p.id)).conflicts).toEqual([]);
    expect(await prisma.activityLog.count({ where: { entity_id: p.id, action: "project.recalc_all" } })).toBe(1);
  });

  it("캘린더 드래그(행사일 이동)도 같은 규칙, 완료된 업무 마감은 바꾸지 않음", async () => {
    const p = await createProject(prisma, pres, { title: "행사", event_start: "2026-12-10", funding: [{ source: "school", amount_planned: 0 }] });
    await applyStandardTemplate(prisma, pres, p.id);
    let t = await tasksByKey(p.id);
    await setCompleted(prisma, pres, t.FIN_BUDGET_RANGE!.id, true);
    const before = day((await prisma.task.findUniqueOrThrow({ where: { id: t.FIN_BUDGET_RANGE!.id } })).due_date);
    await moveProjectDates(prisma, pres, p.id, { event_start: "2026-12-17" });
    t = await tasksByKey(p.id);
    expect(day(t.FIN_BUDGET_RANGE!.due_date)).toBe(before);
    const ms = await prisma.scheduleEvent.findFirstOrThrow({ where: { project_id: p.id } });
    expect(day(ms.start)).toBe("2026-11-26"); // 12/17 - 21
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).quarter).toBeNull();
  });

  it("재원을 교비 → 학생회비로 바꾸면 송부 마일스톤 삭제, 증빙 요구 갱신", async () => {
    const p = await createProject(prisma, pres, { title: "행사", event_start: "2026-12-10", funding: [{ source: "school", amount_planned: 0 }] });
    await applyStandardTemplate(prisma, pres, p.id);
    expect(await prisma.scheduleEvent.count({ where: { project_id: p.id } })).toBe(1);
    await updateProject(prisma, pres, p.id, { title: "행사", event_start: "2026-12-10", expected_beneficiaries: 80, funding: [{ source: "student_fee", amount_planned: 0 }] });
    expect(await prisma.scheduleEvent.count({ where: { project_id: p.id } })).toBe(0);
    const ev = await prisma.evidenceRequirement.findMany({ where: { project_id: p.id } });
    expect(ev.map((e) => `${e.type}:${e.required}`).sort()).toEqual(["beneficiary_roster:true", "photo:true", "receipt:true"]);
  });
});

describe("T8 명단 규칙 (사업 생성 시 증빙 요구 자동 생성)", () => {
  it.each([[80, true], [100, true], [150, false]])("학생회비, 수혜 %d명 → 명단 필수=%s", async (n, required) => {
    const p = await createProject(prisma, pres, { title: `행사${n}`, event_start: "2026-12-10", expected_beneficiaries: n, funding: [{ source: "student_fee", amount_planned: 0 }] });
    const roster = await prisma.evidenceRequirement.findFirstOrThrow({ where: { project_id: p.id, type: "beneficiary_roster" } });
    expect(roster.required).toBe(required);
    expect(day(roster.due_date)).toBe("2026-12-11");
  });
});

describe("T10 기수·분기 설정", () => {
  const term = (over: Record<string, unknown> = {}) => ({
    council_name: "데모 학생회", university: "데모대", college: "데모단과대", term_number: 7, name: "", banner_title: "제7대 데모 학생회", banner_subtitle: "",
    ...previewQuarters({ electionEnd: "2025-11-27", sem1Start: "2026-03-02", sem1End: "2026-06-19", sem2Start: "2026-09-01", nextElectionEnd: "2026-12-20" }),
    ...over,
  });
  it("학사일정 → 분기 저장, 사업 분기 다시 계산, 이력", async () => {
    const p = await createProject(prisma, pres, { title: "x", event_start: "2026-12-10" });
    expect(p.quarter).toBeNull(); // 기본 기수(11/30 종료) 밖
    await updateTerm(prisma, pres, term());
    const t = await prisma.term.findUniqueOrThrow({ where: { id: pres.termId }, include: { council: true } });
    expect(day(t.q4_end)).toBe("2026-12-20");
    expect(t.term_number).toBe(7);
    expect(t.council.name).toBe("데모 학생회");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).quarter).toBe(4);
    expect(await prisma.activityLog.count({ where: { action: "settings.term" } })).toBe(1);
  });
  it("검증: 순서 오류, 학사일정 오류, 권한", async () => {
    await expect(updateTerm(prisma, pres, term({ q2_start: "2026-02-01" }))).rejects.toThrow(/순서/);
    expect(() => previewQuarters({ electionEnd: "2026-05-01", sem1Start: "2026-03-02", sem1End: "2026-06-19", sem2Start: "2026-09-01", nextElectionEnd: "2026-12-20" })).toThrow(/순서/);
    await expect(updateTerm(prisma, { ...pres, role: "member" }, term())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("규칙 파라미터·휴일 설정 (5-7)", () => {
  it("변경 → 진행 중 사업의 제안 마감 재계산 + 이력, 휴일 반영", async () => {
    const p = await createProject(prisma, pres, { title: "x", event_start: "2026-12-10", funding: [{ source: "student_fee", amount_planned: 0 }] });
    await applyStandardTemplate(prisma, pres, p.id);
    const r = await updateRuleSettings(prisma, pres, { PROMO_PUBLISH_LATEST_DAYS: 10, HOLIDAYS: [{ date: "2026-11-30", name: "개교기념일" }] });
    expect(r.projectsRecalculated).toBe(1);
    const t = await tasksByKey(p.id);
    expect(day(t.PRO_PUBLISH!.due_date)).toBe("2026-11-27"); // 12/10-10 = 11/30(휴일) → 11/27(금)
    const params = await loadRuleParams(prisma, pres.termId);
    expect(params.HOLIDAYS).toEqual(["2026-11-30"]);
    expect(params.holidayList[0]!.name).toBe("개교기념일");
    expect(await prisma.activityLog.count({ where: { action: "settings.rules" } })).toBe(1);
  });
  it("잘못된 값·권한 거부, 모르는 키 무시", async () => {
    await expect(updateRuleSettings(prisma, pres, { SCHOOL_TAX_RATE: 5 })).rejects.toThrow(/SCHOOL_TAX_RATE/);
    await expect(updateRuleSettings(prisma, pres, { NOPE: 1 })).rejects.toThrow(/바꿀 설정이 없습니다/);
    await expect(updateRuleSettings(prisma, { ...pres, role: "member" }, { ROSTER_THRESHOLD: 50 })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("기본 공휴일 목록이 시드되어 있다", async () => {
    const params = await loadRuleParams(prisma, pres.termId);
    expect(params.HOLIDAYS).toContain("2026-12-25");
    expect(params.HOLIDAYS).toContain("2026-10-09");
  });
});

describe("기존 설치본 보완", () => {
  it("휴일 목록이 비어 있으면 기본 공휴일을 채우고, 값이 있으면 그대로 둔다", async () => {
    await prisma.setting.update({ where: { term_id_key: { term_id: pres.termId, key: "HOLIDAYS" } }, data: { value: [] } });
    await ensureBaseSetup(prisma);
    expect((await loadRuleParams(prisma, pres.termId)).HOLIDAYS.length).toBeGreaterThan(20);
    await prisma.setting.update({ where: { term_id_key: { term_id: pres.termId, key: "HOLIDAYS" } }, data: { value: [{ date: "2026-11-30", name: "개교기념일" }] } });
    await ensureBaseSetup(prisma);
    expect((await loadRuleParams(prisma, pres.termId)).HOLIDAYS).toEqual(["2026-11-30"]);
  });
});
