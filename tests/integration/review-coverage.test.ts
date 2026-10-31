import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetAllTables } from "@/lib/setup/reset";
import { ensureBaseSetup } from "@/lib/setup/bootstrap";
import { createProject } from "@/lib/services/projects";
import { applyStandardTemplate } from "@/lib/services/schedule";
import { decideProposals } from "@/lib/services/proposals";
import { buildProposals, guessTemplate, similarity, type ActionItem, type ExistingProject } from "@/lib/ai/propose";
import { loadReview } from "@/lib/review";
import { DEFAULT_PARAMS } from "@kgb/rules";
import type { A2Output } from "@/lib/ai/schemas/a2";
import type { Actor } from "@/lib/auth/can";

/**
 * 사용자 요구(2026-10-31, 제14차 회의록 사례): 회의록 제안이 빠짐없이 — 집행매뉴얼 누락 방지, 기획안 마감 빈칸 방지,
 * 회의록 기한(홍보물 행사 1주 전)이 기존 업무에도 반영, 검토 화면에서 국서별 정리·직접 추가·직접 수정.
 * (실제 회의록 원문은 저장소에 넣지 않고, 같은 구조의 가상 문장으로 재현)
 */
type A = Actor & { termId: string };
let pres: A, member: A;
const TODAY = "2026-10-31";
const EVENT = "2026-12-07";
const proj = (over: Partial<A2Output["projects"][number]> = {}): A2Output["projects"][number] => ({
  ref: "P1", existing_project_id: null, title: "기말고사 간식행사", category: "event", event_start: EVENT, venue: null, beneficiaries: null,
  funding: ["student_fee"], uses_vendor: null, evidence: [{ para: 2, quote: "기말고사 간식행사에 관한 건" }], confidence: 0.9, ...over,
});
const task = (title: string, over: Partial<A2Output["tasks"][number]> = {}): A2Output["tasks"][number] => ({
  project_ref: "P1", title, description: null, lead_department: "planning", support_departments: [], template_key: null, assignee_hint: null,
  due_date: null, inferred: false, inference_reason: null, evidence: [{ para: 4, quote: "기획안 작성하여 보고" }], confidence: 0.85, ...over,
});
const ACTIONS: ActionItem[] = [
  { department: "planning", what: "객단가·배급 방식 기획안 작성 보고", due_date: null, para: 4, quote: "기획국에서 기획안 작성하여 보고" },
  { department: "operations", what: "행사 당일 집행매뉴얼 작성", due_date: null, para: 7, quote: "행사당일 집행매뉴얼 작성요망" },
  { department: "promotion", what: "홍보물 제작 마무리", due_date: "2026-11-30", para: 8, quote: "홍보물제작은 간식행사 시작 1주일 전 안에는 마무리" },
];
const pl = (r: { payload: unknown }) => r.payload as { title: string; lead_department: string; due_date: string | null; template_key: string | null; changes?: { due_date?: string } };

async function actor(role: "president" | "member", code?: string): Promise<A> {
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
  member = await actor("member", "promotion");
});

describe("도우미", () => {
  it("업무명 유사도·표준 업무 추정", () => {
    expect(similarity("집행 매뉴얼 작성", "행사 당일 집행매뉴얼 작성")).toBeGreaterThan(0.6);
    expect(similarity("카드뉴스", "예산 정산")).toBe(0);
    expect(similarity("", "x")).toBe(0);
    expect(guessTemplate("행사 당일 집행매뉴얼 작성")).toBe("OPS_MANUAL");
    expect(guessTemplate("홍보물 방식 포함 기획안 여러 버전")).toBe("PLN_DRAFT"); // 기획안이 우선
    expect(guessTemplate("포스터 제작")).toBe("PRO_MAKE");
    expect(guessTemplate("회의 준비")).toBeNull();
  });
});

describe("새 사업: 회의록 액션아이템 빠짐없이", () => {
  it("AI 가 집행매뉴얼을 빠뜨려도 → 집행국 업무(회의록 근거, 기본 체크)로 올라오고, 기획안·홍보물 마감이 비지 않음", () => {
    const rows = buildProposals({
      meetingId: "m14", today: TODAY, params: DEFAULT_PARAMS, existing: [], members: [], actionItems: ACTIONS,
      a2: { projects: [proj()], tasks: [task("기획안 작성(객단가·배급 방식)"), task("홍보물 제작", { lead_department: "promotion", due_date: "2026-11-30", evidence: [{ para: 8, quote: "1주일 전" }] })] },
    });
    const tasks = rows.filter((r) => r.kind === "new_task");
    const manual = tasks.find((r) => /매뉴얼/.test(pl(r).title))!;
    expect(manual).toBeDefined();
    expect(pl(manual).lead_department).toBe("operations");
    expect(manual.inferred).toBe(false); // 회의록에 나온 일 → 기본 체크
    expect(JSON.stringify(manual.evidence)).toContain("집행매뉴얼");
    expect(pl(manual).due_date).not.toBeNull(); // 규칙 엔진: 행사 7일 전
    expect(tasks.filter((r) => /매뉴얼/.test(pl(r).title))).toHaveLength(1); // 중복 없음

    const plan = tasks.find((r) => pl(r).title.startsWith("기획안 작성("))!;
    expect(pl(plan).due_date).not.toBeNull(); // 기획안 마감 빈칸 방지(템플릿 키가 없어도 업무명으로 계산)
    const promo = tasks.find((r) => pl(r).title === "홍보물 제작")!;
    expect(pl(promo).due_date).toBe("2026-11-30"); // 회의록 기한 우선
    for (const r of tasks) expect((r.payload as { assignee_ids: string[] }).assignee_ids).toEqual([]);
  });
});

describe("기존 사업(데모처럼 표준 업무가 이미 있음)", () => {
  async function existingProject() {
    const p = await createProject(prisma, pres, { title: "기말고사 간식행사", event_start: EVENT, funding: [{ source: "student_fee", amount_planned: 1000000 }] });
    await applyStandardTemplate(prisma, pres, p.id, undefined, TODAY);
    const tasks = await prisma.task.findMany({ where: { project_id: p.id, deleted_at: null }, include: { departments: { include: { department: true } } } });
    const ex: ExistingProject = {
      id: p.id, title: p.title, event_start: EVENT, venue: null, expected_beneficiaries: null, uses_external_vendor: false, funding: ["student_fee"],
      tasks: tasks.map((t) => ({ id: t.id, title: t.title, template_key: t.template_key, due: t.due_date?.toISOString().slice(0, 10) ?? null, lead: t.departments.find((d) => d.role === "lead")?.department.code ?? null, done: t.is_completed })),
    };
    return { p, ex, byKey: (k: string) => tasks.find((t) => t.template_key === k)! };
  }

  it("이미 있는 집행매뉴얼은 새로 만들지 않고, 회의록 기한(홍보물 11/30)이 다르면 '업무 변경(마감)' 제안 → 승인 시 확정", async () => {
    const { p, ex, byKey } = await existingProject();
    const rows = buildProposals({
      meetingId: "m14", today: TODAY, params: DEFAULT_PARAMS, existing: [ex], members: [], actionItems: ACTIONS,
      a2: { projects: [proj({ existing_project_id: p.id })], tasks: [task("홍보물 제작", { lead_department: "promotion", template_key: "PRO_MAKE", due_date: "2026-11-30" })] },
    });
    expect(rows.some((r) => r.kind === "new_task" && /매뉴얼/.test(pl(r).title))).toBe(false);
    const upd = rows.find((r) => r.kind === "update_task")!;
    expect(upd.target_id).toBe(byKey("PRO_MAKE").id);
    expect(pl(upd).changes).toEqual({ due_date: "2026-11-30" });

    // 검토 화면 데이터: 기존 사업의 '이미 배정' 업무가 국서와 함께 보이고, 업무 변경 제안의 국서는 대상 업무의 국서
    const meeting = await prisma.meeting.create({ data: { term_id: pres.termId, title: "제14차 회의", meeting_date: new Date(`${TODAY}T00:00:00Z`), meeting_type: "regular", source: "paste", status: "analyzed", uploaded_by: pres.userId } });
    await prisma.proposal.createMany({ data: rows.map((r) => ({ ...r, term_id: pres.termId, source_type: "meeting", source_id: meeting.id })) as never });
    const groups = await loadReview(pres.termId);
    const pg = groups.flatMap((g) => g.projects).find((x) => x.key === p.id)!;
    expect(pg.existing.find((e) => e.id === byKey("OPS_MANUAL").id)?.dept).toBe("operations");
    expect(pg.items.find((i) => i.kind === "update_task")?.dept).toBe("promotion");

    const pending = await prisma.proposal.findFirstOrThrow({ where: { kind: "update_task", status: "pending" } });
    await decideProposals(prisma, pres, { approve: [{ id: pending.id }] });
    const t = await prisma.task.findUniqueOrThrow({ where: { id: byKey("PRO_MAKE").id } });
    expect(t.due_date?.toISOString().slice(0, 10)).toBe("2026-11-30");
    expect(t).toMatchObject({ due_state: "confirmed", due_reason: "회의록 기한" });
  });

  it("같은 회의록 재분석: 그 회의록으로 만든 업무의 (사람이 고친) 마감을 되돌리는 제안은 하지 않는다", async () => {
    const { p, ex, byKey } = await existingProject();
    const id = byKey("PRO_MAKE").id;
    const ex2 = { ...ex, tasks: ex.tasks.map((t) => (t.id === id ? { ...t, fromMeeting: "m14", due: "2026-11-28" } : t)) };
    const input = { today: TODAY, params: DEFAULT_PARAMS, members: [], a2: { projects: [proj({ existing_project_id: p.id })], tasks: [task("홍보물 제작", { lead_department: "promotion" as const, template_key: "PRO_MAKE", due_date: "2026-11-30" })] } };
    expect(buildProposals({ ...input, meetingId: "m14", existing: [ex2] }).some((r) => r.kind === "update_task")).toBe(false);
    expect(buildProposals({ ...input, meetingId: "m15", existing: [ex2] }).some((r) => r.kind === "update_task")).toBe(true); // 다른 회의록이면 제안
  });

  it("검토 화면 직접 수정: 업무 변경 제안의 마감·국서를 바꿔 승인", async () => {
    const { p, ex, byKey } = await existingProject();
    const rows = buildProposals({
      meetingId: "m14", today: TODAY, params: DEFAULT_PARAMS, existing: [ex], members: [],
      a2: { projects: [proj({ existing_project_id: p.id })], tasks: [task("홍보물 제작", { lead_department: "promotion", template_key: "PRO_MAKE", due_date: "2026-11-30" })] },
    });
    const u = rows.find((r) => r.kind === "update_task")!;
    const prop = await prisma.proposal.create({ data: { ...u, term_id: pres.termId, source_type: "meeting", source_id: null } as never });
    await decideProposals(prisma, pres, { approve: [{ id: prop.id, edits: { due_date: "2026-11-28", lead_department: "promotion", support_departments: ["planning"] } }] });
    const t = await prisma.task.findUniqueOrThrow({ where: { id: byKey("PRO_MAKE").id }, include: { departments: { include: { department: true } } } });
    expect(t.due_date?.toISOString().slice(0, 10)).toBe("2026-11-28");
    expect(t.departments.map((d) => `${d.role}:${d.department.code}`).sort()).toEqual(["lead:promotion", "support:planning"]);
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: prop.id } })).status).toBe("edited_approved");
  });
});

describe("검토 화면 '직접 추가' (제안에 빠진 업무)", () => {
  it("승인과 같은 트랜잭션에서 국서·마감과 함께 만든다, 직접 추가만 단독으로도 가능, 국원은 불가", async () => {
    const p = await createProject(prisma, pres, { title: "간식행사", event_start: EVENT });
    const r = await decideProposals(prisma, pres, { create: [
      { project_key: p.id, title: "행사 당일 집행매뉴얼 작성", lead_department: "operations", support_departments: ["planning"], due_date: "2026-11-30" },
      { project_key: null, title: "회의실 예약", lead_department: "secretariat", support_departments: [], due_date: null },
    ] });
    expect(r).toBeDefined();
    const t = await prisma.task.findFirstOrThrow({ where: { title: "행사 당일 집행매뉴얼 작성" }, include: { departments: { include: { department: true } } } });
    expect(t.project_id).toBe(p.id);
    expect(t.template_key).toBe("OPS_MANUAL"); // 사업에 같은 표준 업무가 없으면 연결
    expect(t).toMatchObject({ due_state: "confirmed" });
    expect(t.departments.find((d) => d.role === "lead")?.department.code).toBe("operations");
    const free = await prisma.task.findFirstOrThrow({ where: { title: "회의실 예약" } });
    expect(free.project_id).toBeNull();
    expect(free.due_date).toBeNull();
    await expect(decideProposals(prisma, member, { create: [{ project_key: null, title: "x", lead_department: "promotion", support_departments: [], due_date: null }] })).rejects.toThrow();
  });
});
