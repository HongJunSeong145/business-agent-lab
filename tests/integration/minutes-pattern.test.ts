import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetAllTables } from "@/lib/setup/reset";
import { ensureBaseSetup } from "@/lib/setup/bootstrap";
import { createProject } from "@/lib/services/projects";
import { applyStandardTemplate } from "@/lib/services/schedule";
import { createTask, updateTask } from "@/lib/services/tasks";
import { decideProposals } from "@/lib/services/proposals";
import { meetingForTask } from "@/lib/services/references";
import { planDraftTask } from "@/lib/services/plans";
import { buildProposals, contains, guessDept, taskTitleFrom, type ActionItem } from "@/lib/ai/propose";
import { replaceDemoTemplateTasks } from "@/lib/setup/demo";
import { A2_PROMPT_VERSION, A2_SYSTEM, a2Prompt } from "@/lib/ai/prompts/a2";
import { DEPARTMENT_ROLES } from "@/lib/ai/prompts/common";
import { a2Schema, type A2Output } from "@/lib/ai/schemas/a2";
import { DEFAULT_PARAMS } from "@kgb/rules";
import type { Actor } from "@/lib/auth/can";

/**
 * 사용자 결정(2026-10-31): 회의록 기준 승인요청 패턴 — 국서별 업무(기획 11/17 → 홍보 11/27 → 집행 매뉴얼 · 재정 준비),
 * 마감은 행사일·선후관계로 역산(근거 표시), 국서 역할 목록은 판단 기준일 뿐 업무로 자동 생성하지 않음,
 * 레퍼런스는 그 사업의 가장 최근 회의록 기준, 승인된 업무도 국장이 직접 수정.
 */
type A = Actor & { termId: string };
let pres: A, head: A;
const TODAY = "2026-10-31";
const EVENT = "2026-12-07";
const ev = (para: number, quote: string) => [{ para, quote }];
// 실제 모델이 내야 하는 결과(사용자가 알려 준 패턴)를 그대로 넣었을 때 코드가 이렇게 승인요청을 만든다
const PATTERN: A2Output = a2Schema.parse({
  projects: [{ ref: "P1", existing_project_id: null, title: "기말고사 간식행사", category: "event", event_start: EVENT, venue: null, beneficiaries: null, funding: ["student_fee"], uses_vendor: null, evidence: ev(2, "기말고사 간식행사에 관한 건"), confidence: 0.95 }],
  tasks: [
    { project_ref: "P1", title: "간식행사 기획안 작성(여러 버전)", description: "객단가·배급 방식을 정하고 오프라인 홍보 비용과 간식 수량을 비교한 여러 버전", lead_department: "planning", support_departments: ["finance"], template_key: "PLN_DRAFT", assignee_hint: null,
      due_date: "2026-11-17", due_basis: "reasoned", due_reason: "홍보물이 행사 10일 전(11/27)까지 나오려면 기획안은 11/17까지", checklist: ["객단가·배급 방식 결정", "온라인 전용 vs 오프라인 홍보 포함 버전 비교"],
      inferred: false, inference_reason: null, evidence: ev(4, "기획국에서 기획안 작성하여 보고"), confidence: 0.9 },
    { project_ref: "P1", title: "간식행사 홍보물 작업 정리·제작(기획안 기준)", description: "기획안에 맞춰 홍보물 작업을 투두로 옮기고 제작", lead_department: "promotion", support_departments: [], template_key: "PRO_MAKE", assignee_hint: null,
      due_date: "2026-11-27", due_basis: "reasoned", due_reason: "회의록 상한 11/30, 게시 기간을 두려면 10일 전", checklist: [], inferred: false, inference_reason: null, evidence: ev(8, "홍보물제작은 간식행사 시작 1주일 전"), confidence: 0.9 },
    { project_ref: "P1", title: "간식행사 재정 준비(영수 처리·업체 정리·예산안)", description: "영수 처리 준비, 간식 업체·가격 정리, 기획안 기반 예산안", lead_department: "finance", support_departments: [], template_key: null, assignee_hint: null,
      due_date: "2026-12-20", due_basis: "reasoned", due_reason: "행사 뒤 날짜(잘못된 값)", checklist: ["영수증·이체내역 처리 준비", "간식 업체·가격 정리", "기획안 기반 예산안"], inferred: false, inference_reason: null, evidence: ev(6, "학생회비로 집행할 사업임"), confidence: 0.8 },
  ],
});
// A1 이 집행매뉴얼 문장에 국서를 못 붙였고(주어 없음), AI 가 업무에서 빠뜨린 상황
const ACTIONS: ActionItem[] = [
  { department: null, what: "행사당일 집행매뉴얼 작성", due_date: null, para: 7, quote: "행사당일 집행매뉴얼 작성요망" },
  { department: "finance", what: "영수 처리 준비", due_date: null, para: 6, quote: "학생회비로 집행할 사업임" },
  { department: "planning", what: "기획안 여러 가지 버전으로 검토해 올릴 것", due_date: null, para: 9, quote: "기획안 여러 가지 버전으로 검토해 올릴 것" },
];
const pl = (r: { payload: unknown }) => r.payload as { title: string; lead_department: string; due_date: string | null; due_reason: string | null; acceptance_criteria: { text: string }[] };

async function actor(role: "president" | "head", code?: string): Promise<A> {
  const term = await ensureBaseSetup(prisma);
  const d = code ? await prisma.department.findFirstOrThrow({ where: { term_id: term.id, code } }) : null;
  const u = await prisma.user.create({ data: { email: `${role}-${Math.random()}@t.test`, display_name: role, status: "active" } });
  await prisma.membership.create({ data: { user_id: u.id, term_id: term.id, role, department_id: d?.id ?? null } });
  return { userId: u.id, role, departmentId: d?.id ?? null, departmentCode: code ?? null, termId: term.id };
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
  await ensureBaseSetup(prisma, new Date(`${TODAY}T00:00:00Z`));
  pres = await actor("president");
  head = await actor("head", "promotion");
});

describe("회의록 → 국서별 승인요청 패턴", () => {
  it("역산 마감(근거 표시)·체크리스트(완료 기준)·행사 뒤 날짜 거부, 표준 업무 자동 추가 없음, 빠진 집행매뉴얼은 국서 추정으로 보완", () => {
    const rows = buildProposals({ meetingId: "m", today: TODAY, params: DEFAULT_PARAMS, existing: [], members: [], a2: PATTERN, actionItems: ACTIONS });
    const tasks = rows.filter((r) => r.kind === "new_task");
    const by = (re: RegExp) => tasks.find((r) => re.test(pl(r).title))!;
    expect(pl(by(/기획안/))).toMatchObject({ lead_department: "planning", due_date: "2026-11-17" });
    expect(pl(by(/기획안/)).due_reason).toMatch(/^역산\(AI\): 홍보물이 행사 10일 전/);
    expect(pl(by(/기획안/)).acceptance_criteria.map((c) => c.text)).toEqual(["객단가·배급 방식 결정", "온라인 전용 vs 오프라인 홍보 포함 버전 비교"]);
    expect(pl(by(/홍보물/))).toMatchObject({ lead_department: "promotion", due_date: "2026-11-27" });
    const fin = by(/재정 준비/);
    expect(pl(fin).due_date).toBeNull(); // 행사(12/7) 뒤 날짜는 버림 — 근거 없는 날짜를 넣지 않음
    expect(pl(fin).acceptance_criteria).toHaveLength(3);
    const manual = by(/집행매뉴얼/);
    expect(pl(manual).lead_department).toBe("operations"); // 주어 없는 '작성요망' → 국서 역할로 추정
    expect(pl(manual).due_date).toBe("2026-11-30"); // 규칙 엔진: 행사 7일 전
    expect(manual.inferred).toBe(false);
    expect((manual.payload as { template_key: string | null }).template_key).toBe("OPS_MANUAL"); // 종류를 붙여 선후관계·마감 재계산에 쓰임
    // '영수 처리 준비'는 재정 업무 체크리스트에, '기획안 여러 버전'은 기획안 업무에 이미 담김 → 중복 업무 없음
    expect(tasks.map((r) => pl(r).title)).toHaveLength(4);
    expect(tasks.some((r) => r.inferred)).toBe(false);
    expect(rows.filter((r) => r.kind === "new_task").map((r) => pl(r).lead_department).sort()).toEqual(["finance", "operations", "planning", "promotion"]); // 사무국 업무 없음
  });

  it("승인하면 홍보물이 기획안 작성 업무 뒤에 묶여(기획안 결재 전 차단) 국서별 투두가 된다", async () => {
    const rows = buildProposals({ meetingId: "m", today: TODAY, params: DEFAULT_PARAMS, existing: [], members: [], a2: PATTERN, actionItems: ACTIONS });
    const meeting = await prisma.meeting.create({ data: { term_id: pres.termId, title: "제14차 회의", meeting_date: new Date(`${TODAY}T00:00:00Z`), meeting_type: "regular", source: "paste", status: "analyzed", uploaded_by: pres.userId } });
    await prisma.proposal.createMany({ data: rows.map((r) => ({ ...r, term_id: pres.termId, source_type: "meeting", source_id: meeting.id })) as never });
    const props = await prisma.proposal.findMany({ where: { status: "pending" } });
    await decideProposals(prisma, pres, { approve: props.map((p) => ({ id: p.id })) });
    const project = await prisma.project.findFirstOrThrow({ where: { title: "기말고사 간식행사" } });
    const tasks = await prisma.task.findMany({ where: { project_id: project.id }, include: { departments: { include: { department: true } } } });
    expect(tasks).toHaveLength(4);
    const plan = tasks.find((t) => t.template_key === "PLN_DRAFT")!;
    const promo = tasks.find((t) => t.template_key === "PRO_MAKE")!;
    expect(await prisma.taskDependency.count({ where: { task_id: promo.id, depends_on_task_id: plan.id } })).toBe(1);
    expect(promo.status).toBe("blocked");
    expect(plan.acceptance_criteria).toEqual([{ text: "객단가·배급 방식 결정", done: false }, { text: "온라인 전용 vs 오프라인 홍보 포함 버전 비교", done: false }]);
    // 국장이 홍보물 마감을 고쳐도(일정 자동 재계산) 회의록·역산 근거 마감(기획안 11/17)은 덮어쓰지 않는다 — 직접 점검에서 발견
    await updateTask(prisma, head, promo.id, { due_date: "2026-11-26" });
    const planAfter = await prisma.task.findUniqueOrThrow({ where: { id: plan.id } });
    expect(planAfter.due_date?.toISOString().slice(0, 10)).toBe("2026-11-17");
    expect(planAfter.due_reason).toMatch(/^역산\(AI\)/);
  });

  it("승인된 업무도 국장이 국서 공간에서 직접 수정(업무명·설명·마감·국서·완료 기준)", async () => {
    const p = await createProject(prisma, pres, { title: "간식", event_start: EVENT });
    const dept = Object.fromEntries((await prisma.department.findMany({ where: { term_id: pres.termId } })).map((d) => [d.code, d.id]));
    const t = await createTask(prisma, pres, { title: "홍보물", lead_department_id: dept.promotion, project_id: p.id });
    await updateTask(prisma, head, t.id, { title: "간식행사 포스터·카드뉴스", description: "기획안 v2 기준", due_date: "2026-11-26", support_department_ids: [dept.planning], acceptance_criteria: [{ text: "포스터 시안", done: false }] });
    const after = await prisma.task.findUniqueOrThrow({ where: { id: t.id }, include: { departments: true } });
    expect(after).toMatchObject({ title: "간식행사 포스터·카드뉴스", description: "기획안 v2 기준", due_state: "confirmed" });
    expect(after.departments).toHaveLength(2);
  });
});

describe("프롬프트: 국서 역할은 판단 기준(업무 목록 아님) + 사용자 패턴 예시", () => {
  it("A2 a2-v4 에 역할 블록·패턴 예시·역산 규칙·데모 제외 규칙이 들어 있다", () => {
    expect(A2_PROMPT_VERSION).toBe("a2-v4");
    expect(A2_SYSTEM).toContain(DEPARTMENT_ROLES);
    expect(DEPARTMENT_ROLES).toContain("업무로 만들지 않는다");
    const p = a2Prompt({ meetingDate: TODAY, summaryJson: "{}", projects: [] });
    expect(p).toContain("11/17까지 기획안 마무리");
    expect(p).toContain("due_basis=\"reasoned\"");
    expect(p).toContain("[데모]");
    expect(p).toContain("사무국: 회의록에 사무국이 할 일이 없으므로 업무를 만들지 않는다");
  });
  it("국서 추정·포함 비율", () => {
    expect(guessDept("행사당일 집행매뉴얼 작성요망")).toBe("operations");
    expect(guessDept("홍보물 제작")).toBe("promotion");
    expect(guessDept("영수 처리 준비")).toBe("finance");
    expect(guessDept("제휴 문의")).toBe("secretariat");
    expect(guessDept("회의")).toBeNull();
    expect(taskTitleFrom("행사당일 집행매뉴얼 작성요망")).toBe("행사 당일 집행매뉴얼 작성");
    expect(taskTitleFrom("기획안 여러 가지 버전으로 검토해 올릴 것")).toBe("기획안 여러 가지 버전으로 검토");
    expect(taskTitleFrom("홍보물 마무리 되었으면 좋겠음.")).toBe("홍보물 마무리");
    expect(taskTitleFrom("카드뉴스 제작")).toBe("카드뉴스 제작");
    expect(contains("간식행사 재정 준비 영수증·이체내역 처리 준비", "영수 처리 준비")).toBeGreaterThan(0.6);
    expect(contains("abc", "")).toBe(0);
  });
});

describe("레퍼런스는 그 사업의 가장 최근 회의록 기준", () => {
  it("업무를 만든 예전 회의록보다, 같은 사업에 연결된 더 최근 회의록(대기 제안 포함)을 쓴다", async () => {
    const p = await createProject(prisma, pres, { title: "간식", event_start: EVENT });
    const mk = async (title: string, date: string) => {
      const m = await prisma.meeting.create({ data: { term_id: pres.termId, title, meeting_date: new Date(`${date}T00:00:00Z`), meeting_type: "regular", source: "paste", status: "analyzed", uploaded_by: pres.userId } });
      await prisma.meetingAnalysis.create({ data: { meeting_id: m.id, version: 1, summary: { title }, model: "x", prompt_version: "a1" } as never });
      return m;
    };
    const old = await mk("제12차", "2026-10-20");
    const neu = await mk("제14차", "2026-10-30");
    const prop = await prisma.proposal.create({ data: { term_id: pres.termId, source_type: "meeting", source_id: old.id, kind: "new_task", project_key: p.id, target_id: p.id, payload: {}, status: "approved", dedupe_key: "o" } });
    await prisma.proposal.create({ data: { term_id: pres.termId, source_type: "meeting", source_id: neu.id, kind: "new_task", project_key: p.id, target_id: p.id, payload: {}, status: "pending", dedupe_key: "n" } });
    expect((await meetingForTask(prisma, { source_proposal_id: prop.id, project_id: p.id }))?.title).toBe("제14차");
    expect((await meetingForTask(prisma, { source_proposal_id: prop.id, project_id: null }))?.title).toBe("제12차"); // 사업 없는 업무는 자기 회의록
    expect(await meetingForTask(prisma, { source_proposal_id: null, project_id: null })).toBeNull();
  });
});

describe("기획안 업무 찾기", () => {
  it("예전 기획안 업무보다 끝나지 않은 최근 기획안 업무(키 없이 '기획안' 제목인 기획국 업무 포함)를 고른다", async () => {
    const p = await createProject(prisma, pres, { title: "간식", event_start: EVENT });
    const dept = Object.fromEntries((await prisma.department.findMany({ where: { term_id: pres.termId } })).map((d) => [d.code, d.id]));
    const old = await createTask(prisma, pres, { title: "기획안 초안 작성", lead_department_id: dept.planning, project_id: p.id });
    await prisma.task.update({ where: { id: old.id }, data: { template_key: "PLN_DRAFT", is_completed: true } });
    const neu = await createTask(prisma, pres, { title: "간식행사 기획안 작성(여러 버전)", lead_department_id: dept.planning, project_id: p.id });
    await createTask(prisma, pres, { title: "기획안 기준 홍보물", lead_department_id: dept.promotion, project_id: p.id }); // 기획국 업무가 아님
    expect((await planDraftTask(prisma, p.id))?.id).toBe(neu.id);
  });
});

describe("예전 데모 데이터 정리", () => {
  it("데모 사업의 손대지 않은 표준 업무만 지우고 국서별 예시 업무로 바꾼다(한 번만), 일반 사업·손댄 업무는 그대로", async () => {
    const demo = await createProject(prisma, pres, { title: "[데모] 기말고사 간식 나눔", event_start: "2026-12-09" });
    await prisma.project.update({ where: { id: demo.id }, data: { is_demo: true } });
    await applyStandardTemplate(prisma, pres, demo.id, undefined, TODAY);
    const real = await createProject(prisma, pres, { title: "실제 사업", event_start: "2026-12-09" });
    await applyStandardTemplate(prisma, pres, real.id, undefined, TODAY);
    const touched = await prisma.task.findFirstOrThrow({ where: { project_id: demo.id, template_key: "PRO_MAKE" } });
    await prisma.task.update({ where: { id: touched.id }, data: { manual_progress: 40 } });
    const realCount = await prisma.task.count({ where: { project_id: real.id, deleted_at: null } });

    const r = await replaceDemoTemplateTasks(prisma);
    expect(r.replaced).toBeGreaterThan(5);
    const left = await prisma.task.findMany({ where: { project_id: demo.id, deleted_at: null } });
    expect(left.map((t) => t.title)).toEqual(expect.arrayContaining(["간식 나눔 기획안 작성(여러 버전)", "간식 나눔 당일 집행매뉴얼 작성", "간식 나눔 재정 준비(영수 처리·업체 정리·예산안)"]));
    expect(left.some((t) => t.id === touched.id)).toBe(true); // 사람이 손댄 것은 유지
    expect(await prisma.task.count({ where: { project_id: real.id, deleted_at: null } })).toBe(realCount);
    expect((await replaceDemoTemplateTasks(prisma)).replaced).toBe(0); // 한 번만
  });
});
