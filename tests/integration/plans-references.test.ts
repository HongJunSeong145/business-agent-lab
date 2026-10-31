import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { strToU8 } from "fflate";
import { prisma } from "@/lib/db";
import { resetAllTables } from "@/lib/setup/reset";
import { ensureBaseSetup } from "@/lib/setup/bootstrap";
import { createProject } from "@/lib/services/projects";
import { applyStandardTemplate } from "@/lib/services/schedule";
import { createTask, setManualProgress, updateTask } from "@/lib/services/tasks";
import { approvePlan, getPlan, rejectPlan, savePlanVersion, submitPlan } from "@/lib/services/plans";
import { addReference, deleteReference, listReferences, requestReferences } from "@/lib/services/references";
import { runReferenceJob } from "@/lib/ai/reference";
import { AiSearchUnavailableError, MockProvider, type AiProvider, type CompleteRequest } from "@/lib/ai/provider";
import { MOCK_HANDLERS, MOCK_SEARCH_HANDLERS } from "@/lib/ai/mock";
import { sanitizeMarkup } from "@/lib/ai/sanitize";
import { ForbiddenError, type Actor } from "@/lib/auth/can";
import type { Storage } from "@/lib/storage";

/** Phase 7: 기획안 모듈(D7) + 레퍼런스·A5 (T19) — 결정적 mock 공급자 */
class MemoryStorage implements Storage {
  readonly driver = "local" as const;
  files = new Map<string, Uint8Array>();
  async put(k: string, d: Uint8Array) { this.files.set(k, d); }
  async get(k: string) { return this.files.get(k) ?? null; }
  async delete(k: string) { this.files.delete(k); }
}
type A = Actor & { termId: string };
let pres: A, planner: A, promo: A, sec: A;
let dept: Record<string, string>;
let storage: MemoryStorage;
const mock = new MockProvider(MOCK_HANDLERS, MOCK_SEARCH_HANDLERS);
const TODAY = "2026-10-31";

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
  sec = await user("member", "secretariat");
  storage = new MemoryStorage();
});

const FIELDS = {
  title: "기말고사 간식 나눔", event_date: "2026-12-09", datetime: "2026-12-09 12:00", venue: "데모관 로비", budget: 400000, host: "학생회", organizer: "기획국",
  purpose: "시험 응원", content: "간식 80인분 배부", timetable: [{ time: "12:00", item: "배부 시작" }], budget_scenarios: [],
};

/** 학생회비 사업 + 표준 업무 */
async function projectWithTemplates() {
  const p = await createProject(prisma, pres, { title: "간식 나눔", event_start: "2026-12-09", venue: "데모관", expected_beneficiaries: 80, funding: [{ source: "student_fee", amount_planned: 400000 }] });
  await applyStandardTemplate(prisma, pres, p.id, undefined, TODAY);
  const tasks = await prisma.task.findMany({ where: { project_id: p.id, deleted_at: null } });
  const byKey = (k: string) => tasks.find((t) => t.template_key === k)!;
  return { p, byKey };
}
const status = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id } })).status;

describe("기획안 모듈 (D7)", () => {
  it("초안 저장 → '초안 있으면 착수' 업무 해제, 결재 → 초안·결재 업무 완료 + 결재 의존 업무 todo + 담당자 알림", async () => {
    const { p, byKey } = await projectWithTemplates();
    const draft = byKey("PLN_DRAFT");
    const partner = byKey("SEC_PARTNER_LIST"); // 초안 있으면 착수
    const manual = byKey("OPS_MANUAL"); // 결재 후 착수
    await updateTask(prisma, pres, manual.id, { assignee_ids: [promo.userId] });
    expect(await status(partner.id)).toBe("blocked");
    expect(await status(manual.id)).toBe("blocked");
    expect(await status(draft.id)).toBe("blocked"); // 예산 범위(초안 있으면 착수) 대기 중

    // 권한: 홍보국원은 작성 불가
    await expect(savePlanVersion(prisma, storage, promo, p.id, { fields: FIELDS })).rejects.toMatchObject({ status: 403 });
    const v1 = await savePlanVersion(prisma, storage, planner, p.id, { fields: { ...FIELDS, budget: null }, note: "초안" });
    expect(v1).toMatchObject({ versionNo: 1, missing: ["예산액"] });
    expect(await status(draft.id)).toBe("in_progress");
    expect(await status(partner.id)).toBe("todo"); // 초안이 생겨 풀림
    expect(await status(manual.id)).toBe("blocked");

    await expect(submitPlan(prisma, planner, p.id)).rejects.toThrow(/예산액/);
    await savePlanVersion(prisma, storage, planner, p.id, { fields: FIELDS });
    await submitPlan(prisma, planner, p.id);
    expect(await prisma.notification.count({ where: { type: "plan_submitted" } })).toBeGreaterThan(0);
    await expect(approvePlan(prisma, planner, p.id)).rejects.toBeInstanceOf(ForbiddenError);

    const r = await approvePlan(prisma, pres, p.id);
    expect(r.versionNo).toBe(2);
    const view = await getPlan(prisma, pres, p.id);
    expect(view.status).toBe("approved");
    expect(view.versions[0]!.approvedAt).toBeTruthy();
    for (const k of ["PLN_DRAFT", "PLN_APPROVAL"]) {
      const t = await prisma.task.findUniqueOrThrow({ where: { id: byKey(k).id } });
      expect(t.is_completed).toBe(true);
      expect(await prisma.progressHistory.findFirst({ where: { task_id: t.id, field: "completed" } })).toMatchObject({ reason: "기획안 v2 결재로 완료" });
    }
    expect(await status(manual.id)).toBe("todo"); // 결재 의존 업무 자동 해제
    expect(r.unblocked.map((u) => u.id)).toContain(manual.id);
    expect(await prisma.notification.count({ where: { user_id: promo.userId, type: "plan_approved", title: { contains: "착수할 수 있습니다" } } })).toBe(1);
    expect(await prisma.notification.count({ where: { user_id: planner.userId, type: "plan_approved" } })).toBe(1); // 작성자
    expect(await prisma.activityLog.count({ where: { entity_id: p.id, action: "plan.approve" } })).toBe(1);

    // 결재 후 수정: 결재본 유지, 이미 풀린 업무를 다시 막지 않음 → 재결재 시 변경 알림
    await savePlanVersion(prisma, storage, planner, p.id, { fields: { ...FIELDS, venue: "데모관 2층" } });
    expect((await getPlan(prisma, pres, p.id)).status).toBe("draft");
    expect((await getPlan(prisma, pres, p.id)).approvedVersionId).toBe(view.versions[0]!.id);
    expect(await status(manual.id)).toBe("todo");
    await approvePlan(prisma, pres, p.id);
    expect(await prisma.notification.count({ where: { user_id: promo.userId, title: { contains: "v2 → v3로 변경 결재" } } })).toBe(1);
  });

  it("초안 기반 선착수 업무는 결재 시 '결재본 확인' 알림, 반려는 사유 필수·작성자 알림, 첨부는 문서 형식만", async () => {
    const { p, byKey } = await projectWithTemplates();
    const promoMake = byKey("PRO_TIER");
    await updateTask(prisma, pres, promoMake.id, { assignee_ids: [promo.userId], allow_draft_start: true });
    await setManualProgress(prisma, pres, byKey("FIN_BUDGET_RANGE").id, { value: 50 });
    await savePlanVersion(prisma, storage, planner, p.id, { fields: FIELDS });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: promoMake.id } })).started_on_draft_plan).toBe(true);
    await setManualProgress(prisma, promo, promoMake.id, { value: 30 });
    await expect(rejectPlan(prisma, pres, p.id, "")).rejects.toThrow(/사유/);
    await rejectPlan(prisma, pres, p.id, "예산 근거 보완");
    expect(await prisma.notification.findFirst({ where: { user_id: planner.userId, type: "plan_rejected" } })).toMatchObject({ body: "예산 근거 보완" });
    await approvePlan(prisma, pres, p.id);
    expect(await prisma.notification.count({ where: { user_id: promo.userId, title: { contains: "초안 기준으로 먼저 착수" } } })).toBe(1);

    await expect(savePlanVersion(prisma, storage, planner, p.id, { fields: FIELDS, file: { name: "a.txt", bytes: strToU8("x") } })).rejects.toThrow(/PDF·DOCX/);
    const pdf = new Uint8Array(await import("node:fs").then((f) => f.readFileSync("tests/fixtures/minutes/minutes.pdf")));
    await savePlanVersion(prisma, storage, planner, p.id, { fields: FIELDS, file: { name: "기획안.pdf", bytes: pdf } });
    expect((await getPlan(prisma, sec, p.id)).versions[0]!.file?.name).toBe("기획안.pdf");
  });
});

describe("레퍼런스 (T19)", () => {
  async function promoTask() {
    const { p, byKey } = await projectWithTemplates();
    await savePlanVersion(prisma, storage, planner, p.id, { fields: FIELDS });
    const t = byKey("PRO_MAKE");
    await updateTask(prisma, pres, t.id, { assignee_ids: [promo.userId] });
    return { p, t };
  }

  it("지시 텍스트 포함 의뢰 → 출처 링크 레퍼런스 + 국서 형식 예시안, 사용한 기획안 버전 기록, 알림", async () => {
    const { t } = await promoTask();
    const seen: CompleteRequest[] = [];
    const spy: AiProvider = { name: "mock", available: true, model: "mock", complete: (r) => (seen.push(r), mock.complete(r)), search: (r) => mock.search(r) };
    const { requestId, aiJobId } = await requestReferences(prisma, promo, t.id, { instruction: "MZ 감성 카드뉴스로", usePastWork: true }, true);
    await expect(requestReferences(prisma, promo, t.id, {}, true)).rejects.toThrow(/이미 제작 중/);
    const r = await runReferenceJob(prisma, spy, aiJobId);
    expect(r).toMatchObject({ outcome: "succeeded", searchFailed: false });
    expect(seen[0]!.prompt).toContain("MZ 감성 카드뉴스로");
    expect(seen[0]!.prompt).toContain("기획안 v1(초안 기준 — 결재 전)");
    expect(seen[0]!.documents!.map((d) => d.name)).toEqual(expect.arrayContaining(["검색 결과", "기획안 v1 (초안)"]));

    const view = await listReferences(prisma, sec, t.id, true); // 다른 국서도 열람
    expect(view.canAdd).toBe(false);
    const search = view.items.filter((i) => i.origin === "ai_search");
    expect(search).toHaveLength(2);
    expect(search.every((i) => i.url?.startsWith("https://example.org/"))).toBe(true);
    const ex = view.items.filter((i) => i.origin === "ai_generated");
    expect(ex.map((i) => i.format)).toEqual(expect.arrayContaining(["markdown", "svg"]));
    expect(ex.find((i) => i.format === "markdown")!.content).toContain("※ 기획안 초안 기준");
    const req = view.requests.find((x) => x.id === requestId)!;
    expect(req.status).toBe("done");
    expect(req.snapshot).toMatchObject({ plan: { versionNo: 1, isDraft: true }, searchFailed: false });
    expect(await prisma.notification.count({ where: { user_id: promo.userId, type: "reference_done" } })).toBe(1);
    expect(await status(t.id)).not.toBe("todo");
    expect(await prisma.aiRun.count({ where: { agent: { in: ["a5_search", "a5"] }, output_valid: true } })).toBe(2);
  });

  it("목록 밖 출처 번호는 버리고, 검색 실패 시 내부 자료만으로 예시안 + '외부 레퍼런스 검색 실패'", async () => {
    const { t } = await promoTask();
    const liar: AiProvider = {
      name: "mock", available: true, model: "mock",
      search: (r) => mock.search(r),
      complete: async (r) => {
        const base = (await mock.complete(r)).json as { references: { source_id: string }[] };
        return { json: { ...base, references: [...base.references, { source_id: "S9", summary: "가짜", benchmark_points: [], relevance: "x" }] }, model: "mock", inputTokens: 0, outputTokens: 0, costUsd: 0 };
      },
    };
    const a = await requestReferences(prisma, promo, t.id, {}, true);
    await runReferenceJob(prisma, liar, a.aiJobId);
    expect((await listReferences(prisma, promo, t.id, true)).items.filter((i) => i.origin === "ai_search")).toHaveLength(2);

    const noSearch: AiProvider = { name: "mock", available: true, model: "mock", complete: (r) => mock.complete(r), search: async () => { throw new AiSearchUnavailableError("검색 결과 없음"); } };
    const b = await requestReferences(prisma, promo, t.id, {}, true);
    const r = await runReferenceJob(prisma, noSearch, b.aiJobId);
    expect(r.searchFailed).toBe(true);
    const req = (await listReferences(prisma, promo, t.id, true)).requests.find((x) => x.id === b.requestId)!;
    expect(req.snapshot?.searchNote).toMatch(/외부 레퍼런스 검색 실패/);
    expect(await prisma.referenceItem.count({ where: { request_id: b.requestId, origin: "ai_search" } })).toBe(0);
    expect(await prisma.referenceItem.count({ where: { request_id: b.requestId, origin: "ai_generated" } })).toBeGreaterThan(0);
  });

  it("사용자 링크·파일 추가·삭제 권한, AI 없으면 의뢰 503, 사무국 이메일 문안은 '발송 전 검토 필요'", async () => {
    const { t } = await promoTask();
    await expect(addReference(prisma, storage, sec, t.id, { url: "https://a.example" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addReference(prisma, storage, promo, t.id, { url: "javascript:alert(1)" })).rejects.toThrow(/http/);
    const link = await addReference(prisma, storage, promo, t.id, { url: "https://www.example.com/poster", note: "색감 참고" });
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    await addReference(prisma, storage, promo, t.id, { file: { name: "참고.png", bytes: png } });
    await expect(addReference(prisma, storage, promo, t.id, { file: { name: "x.svg", bytes: strToU8("<svg/>") } })).rejects.toThrow(/지원하지 않는/);
    const view = await listReferences(prisma, promo, t.id, true);
    expect(view.items.map((i) => i.kind).sort()).toEqual(["file", "link"]);
    expect(view.items.find((i) => i.kind === "file")!.preview).toBe("image");
    const other = await user("member", "promotion");
    await expect(deleteReference(prisma, other, link.id)).rejects.toThrow(/추가한 사람/);
    await deleteReference(prisma, promo, link.id);
    expect((await listReferences(prisma, promo, t.id, true)).items).toHaveLength(1);
    await expect(requestReferences(prisma, promo, t.id, {}, false)).rejects.toMatchObject({ status: 503 });

    const secTask = await createTask(prisma, pres, { title: "제휴 요청", lead_department_id: dept.secretariat, assignee_ids: [sec.userId] });
    const a = await requestReferences(prisma, sec, secTask.id, {}, true);
    await runReferenceJob(prisma, mock, a.aiJobId);
    const mail = (await listReferences(prisma, sec, secTask.id, true)).items.find((i) => i.title.includes("이메일"))!;
    expect(mail.needsReview).toBe(true);
  });
});

describe("AI 예시안 HTML/SVG 정리", () => {
  it("스크립트·이벤트·javascript:·외부 로딩 제거", () => {
    const dirty = `<svg onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><text>안녕</text></a><foreignObject><div>x</div></foreignObject><image href="data:image/png;base64,AAA"/><style>@import url(https://evil); .a{background:url('https://evil/x.png')}</style></svg>`;
    const clean = sanitizeMarkup(dirty);
    expect(clean).not.toMatch(/script|onload|javascript:|foreignObject|@import|https:\/\/evil|data:image/);
    expect(clean).toContain("<text>안녕</text>");
  });
});
