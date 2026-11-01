import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./fixtures";
import { loginOk } from "./helpers";
import { sql } from "./db";

/**
 * Phase 7: 기획안(양식·버전·결재) → 결재 의존 업무 자동 todo(D7) / 레퍼런스 제작 의뢰(mock A5) — T19
 */
test.describe.configure({ mode: "serial" });

const PROJECT = "E2E 기말 간식 나눔";
const PLANNER = "planning.member@demo.kgb.invalid"; // 박기획
const PROMO = "promotion.member@demo.kgb.invalid"; // 장홍보
const TIER = "홍보물 등급 결정(무비용/저비용/고비용)";

const projectId = async () => (await sql<{ id: string }>("SELECT id FROM projects WHERE title = $1", [PROJECT]))[0]!.id;
const taskOf = async (key: string) => (await sql<{ id: string; status: string }>("SELECT t.id, t.status FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.title = $1 AND t.template_key = $2 AND t.deleted_at IS NULL", [PROJECT, key]))[0]!;
const row = (page: Page, title: string) => page.locator("li[data-task-id]").filter({ has: page.getByRole("link", { name: title, exact: true }) });

test("준비: 학생회비 사업 + 표준 업무, 홍보국원 담당 지정", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  const res = await page.request.post("/api/projects", { data: { title: PROJECT, event_start: "2027-01-27", venue: "데모관 로비", expected_beneficiaries: 80, host: "데모단과대학 학생회", organizer: "기획국", funding: [{ source: "student_fee", amount_planned: 400000 }] } });
  expect(res.status()).toBe(201);
  const id = ((await res.json()) as { id: string }).id;
  expect((await page.request.post(`/api/projects/${id}/template`, { data: {} })).status()).toBe(201);
  const [promo] = await sql<{ id: string }>("SELECT id FROM users WHERE email = $1", [PROMO]);
  for (const key of ["PRO_TIER", "PRO_MAKE"]) expect((await page.request.patch(`/api/tasks/${(await taskOf(key)).id}`, { data: { assignee_ids: [promo!.id] } })).status()).toBe(200);
  expect((await taskOf("PRO_TIER")).status).toBe("blocked");
});

test("기획국원: 사업 정보로 채워진 양식 → 필수 항목 입력 → 새 버전 저장 → 결재 요청", async ({ page }) => {
  await loginOk(page, PLANNER, E2E.demoPassword);
  await page.goto(`/projects/${await projectId()}#plan`);
  const panel = page.getByTestId("plan-panel");
  await expect(panel.getByLabel("행사명")).toHaveValue(PROJECT);
  await expect(panel.getByLabel("장소")).toHaveValue("데모관 로비");
  await expect(panel.getByLabel("예산액(원)")).toHaveValue("400000");
  await panel.getByLabel("배경 및 목적").fill("기말고사 기간 학우 응원");
  await panel.getByLabel("행사 내용").fill("간식 80인분 선착순 배부, 수혜자 명단 작성");
  await panel.getByRole("button", { name: "시간 추가" }).click();
  await panel.getByLabel("타임테이블 1 시간").fill("12:00");
  await panel.getByLabel("타임테이블 1 내용").fill("배부 시작");
  await panel.getByLabel("이번 버전 메모(선택)").fill("첫 초안");
  await panel.getByRole("button", { name: "새 버전으로 저장" }).click();
  await expect(page.getByText("기획안을 새 버전으로 저장했습니다.")).toBeVisible();
  await expect(panel.getByTestId("plan-status")).toHaveText("작성 중");
  await expect(panel).toContainText("최신 v1");
  await expect(panel.getByRole("button", { name: "결재", exact: true })).toHaveCount(0); // 국원은 결재 불가
  await panel.getByRole("button", { name: "결재 요청" }).click();
  await expect(panel.getByTestId("plan-status")).toHaveText("결재 요청");
  expect((await taskOf("PLN_DRAFT")).status).toBe("in_progress"); // 초안 생김
});

test("T19: 홍보국원이 지시 텍스트로 레퍼런스 제작 의뢰 → 출처 링크 레퍼런스 + 국서 형식 예시안 + 사용한 기획안 버전 표시", async ({ page }) => {
  await loginOk(page, PROMO, E2E.demoPassword);
  await page.goto(`/departments/promotion?in_project=${await projectId()}`);
  await expect(row(page, TIER).getByTestId("blocked-reason")).toContainText("결재 대기");
  await row(page, TIER).getByTestId("row-references").click();
  const tab = page.getByTestId("references-tab");
  await tab.getByRole("button", { name: "레퍼런스 제작 의뢰" }).click();
  const d = page.getByRole("dialog", { name: "레퍼런스 제작 의뢰" });
  await expect(d).toContainText("v1 초안 기준");
  await d.getByLabel("지시(선택)").fill("20대 감성의 카드뉴스, 5장 이내");
  await d.getByRole("button", { name: "의뢰하기" }).click();
  await expect(page.getByText("의뢰했습니다. 끝나면 알려 드립니다.")).toBeVisible();
  const req = tab.getByTestId("reference-request").first();
  await expect(req).toContainText("제작 완료", { timeout: 30_000 });
  await expect(req).toContainText("지시: 20대 감성의 카드뉴스, 5장 이내");
  await expect(req).toContainText("기획안 v1(초안 기준)");
  const refs = tab.getByTestId("search-reference");
  await expect(refs).toHaveCount(2);
  await expect(refs.first().getByRole("link")).toHaveAttribute("href", /^https:\/\/example\.org\//);
  await expect(refs.first().getByRole("link")).toHaveAttribute("rel", /noopener/);
  const ex = tab.getByTestId("ai-example");
  await expect(ex.first()).toContainText("AI 예시안 — 벤치마킹용");
  await expect(tab.getByRole("img", { name: /목업/ })).toBeVisible(); // SVG 목업은 <img> 로
  await expect(ex.filter({ hasText: "카드뉴스" }).first()).toContainText("※ 기획안 초안 기준");

  // 직접 링크 추가
  await tab.getByLabel("레퍼런스 링크").fill("https://www.example.com/poster-idea");
  await tab.getByLabel("레퍼런스 메모").fill("색감 참고");
  await tab.getByRole("button", { name: "추가", exact: true }).click();
  await expect(tab.getByRole("link", { name: "https://www.example.com/poster-idea" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row(page, TIER).getByTestId("row-references")).toContainText(/\d/);
});

test("회장 결재 → 초안·결재 업무 완료, 결재 의존 업무 자동 todo + 담당자 알림 (D7)", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await page.goto(`/projects/${await projectId()}#plan`);
  const panel = page.getByTestId("plan-panel");
  page.once("dialog", (dlg) => void dlg.accept());
  await panel.getByRole("button", { name: "결재", exact: true }).click();
  await expect(page.getByText("기획안 v1을 결재했습니다.")).toBeVisible();
  await expect(panel.getByTestId("plan-status")).toHaveText("결재 완료");
  await expect(panel).toContainText("결재본 v1");
  await expect.poll(async () => (await taskOf("PLN_APPROVAL")).status).toBe("done");
  expect((await taskOf("PRO_TIER")).status).toBe("todo");
  expect((await taskOf("OPS_MANUAL")).status).toBe("todo");
  const [n] = await sql<{ n: string }>("SELECT count(*) n FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = $1 AND n.type = 'plan_approved'", [PROMO]);
  expect(Number(n!.n)).toBeGreaterThan(0);

  await page.goto(`/departments/promotion?in_project=${await projectId()}`);
  await expect(row(page, TIER).getByTestId("blocked-reason")).toHaveCount(0);
  await row(page, TIER).getByRole("link", { name: TIER, exact: true }).click();
  await expect(page.getByTestId("task-drawer")).toContainText("참고 기획안 v1 (결재본)");
});
