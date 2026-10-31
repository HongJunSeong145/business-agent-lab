import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./fixtures";
import { loginOk } from "./helpers";
import { sql } from "./db";

/** 사용자 요구 재점검 화면 흐름: 레퍼런스 기획안 → 결재 → 결재본 기준 재배정 승인요청, 일괄 수정, 작업물 보관함, 최근 회의록 5개 */
test.describe.configure({ mode: "serial" });
const PROJECT = "E2E 요구 점검 행사";
const PLANNER = "planning.member@demo.kgb.invalid";
const projectId = async () => (await sql<{ id: string }>("SELECT id FROM projects WHERE title = $1", [PROJECT]))[0]!.id;

async function setup(page: Page) {
  const r = await page.request.post("/api/projects", { data: { title: PROJECT, event_start: "2027-02-10", venue: "데모관", expected_beneficiaries: 80, host: "학생회", organizer: "기획국", funding: [{ source: "student_fee", amount_planned: 300000 }] } });
  expect(r.status()).toBe(201);
  const id = ((await r.json()) as { id: string }).id;
  expect((await page.request.post(`/api/projects/${id}/template`, { data: {} })).status()).toBe(201);
}

test("기획국원: AI 레퍼런스 기획안 받기 → 양식 채우기 → 저장 / 회장 결재 → 결재 기획안 기준 재배정 승인요청", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await setup(page);
  await page.context().clearCookies();
  await loginOk(page, PLANNER, E2E.demoPassword);
  await page.goto(`/projects/${await projectId()}#plan`);
  const refs = page.getByTestId("plan-references");
  page.once("dialog", (d) => void d.accept("예산 30만 원 이하"));
  await refs.getByRole("button", { name: "AI 레퍼런스 기획안 받기" }).click();
  await expect(refs.getByRole("button", { name: "이 예시로 양식 채우기" })).toBeVisible({ timeout: 30_000 });
  await expect(refs.getByRole("link", { name: /기획국 공간에서 참고 사이트/ })).toBeVisible();
  await refs.getByRole("button", { name: "이 예시로 양식 채우기" }).click();
  const panel = page.getByTestId("plan-panel");
  await expect(panel.getByLabel("배경 및 목적")).toHaveValue("mock: 행사 목적");
  await panel.getByLabel("행사 날짜").fill("2027-02-12");
  await panel.getByLabel("장소").fill("데모관 2층");
  await panel.getByRole("button", { name: "새 버전으로 저장" }).click();
  await expect(page.getByText("기획안을 새 버전으로 저장했습니다.")).toBeVisible();

  await page.context().clearCookies();
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await page.goto(`/projects/${await projectId()}#plan`);
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("plan-panel").getByRole("button", { name: "결재", exact: true }).click();
  await expect(page.getByText(/기획안 v1을 결재했습니다/)).toBeVisible();
  await expect.poll(async () => Number((await sql<{ n: string }>("SELECT count(*) n FROM proposals WHERE source_type = 'plan' AND status = 'pending'"))[0]!.n), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.goto("/review");
  await expect(page.getByText(/결재 기획안 기준 재배정 — E2E 요구 점검 행사 기획안 v1/)).toBeVisible();
  await expect(page.locator("[data-kind='update_project']")).toContainText("2027-02-12");
  await expect(page.locator("[data-kind='deadline']").first()).toContainText("결재 기획안 v1 행사일");
});

test("국서 공간 일괄 수정: 여러 업무 선택 → 마감 3일 옮기기", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await page.goto(`/departments/promotion?in_project=${await projectId()}`);
  const before = await sql<{ id: string; due_date: string }>("SELECT t.id, to_char(t.due_date,'YYYY-MM-DD') due_date FROM tasks t JOIN task_departments d ON d.task_id = t.id AND d.role='lead' JOIN departments dp ON dp.id = d.department_id WHERE t.project_id = $1 AND dp.code = 'promotion' AND t.due_date IS NOT NULL AND t.deleted_at IS NULL ORDER BY t.title LIMIT 2", [await projectId()]);
  await page.getByRole("button", { name: /여러 업무 선택/ }).click();
  for (const t of before) await page.locator(`li[data-task-id='${t.id}']`).getByRole("checkbox", { name: /선택\(일괄 수정\)/ }).check();
  const bar = page.getByRole("region", { name: "일괄 수정" });
  await expect(bar).toContainText(`${before.length}개 선택`);
  await bar.getByLabel("일괄 작업").selectOption("shift");
  await bar.getByLabel("옮길 날 수").fill("3");
  await bar.getByRole("button", { name: "적용" }).click();
  await expect(page.getByText(`${before.length}개 처리했습니다.`)).toBeVisible();
  for (const t of before) {
    const [n] = await sql<{ d: string; s: string }>("SELECT to_char(due_date,'YYYY-MM-DD') d, due_state s FROM tasks WHERE id = $1", [t.id]);
    const expected = new Date(new Date(`${t.due_date}T00:00:00Z`).getTime() + 3 * 86400_000).toISOString().slice(0, 10);
    expect(n).toEqual({ d: expected, s: "confirmed" });
  }
});

test("작업물 보관함·최근 회의록 5개·완료된 사업 탭", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await page.goto(`/projects/${await projectId()}#archive`);
  await expect(page.locator("#archive")).toContainText("작업물 보관함");
  await page.goto("/");
  const recent = page.locator("section, div").filter({ has: page.getByRole("heading", { name: "최근 회의록" }) }).last();
  expect(await recent.locator("a[href*='?meeting=']").count()).toBeLessThanOrEqual(5);
  await page.goto("/projects");
  await page.getByRole("link", { name: "완료된 사업(작업물 보관)" }).click();
  await expect(page).toHaveURL(/status=done/);
});
