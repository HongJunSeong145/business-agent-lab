import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./fixtures";
import { loginOk } from "./helpers";
import { sql } from "./db";

/**
 * 사용자 요구(2026-10-31): 이미 배정된 업무 바로 삭제, 모든 작업·현황 수시 수정·삭제·되살리기, 다른 화면 변경의 실시간 반영.
 */
test.describe.configure({ mode: "serial" });
const PROJECT = "E2E 실시간 수정 행사";
const deptId = async (code: string) => (await sql<{ id: string }>("SELECT d.id FROM departments d WHERE d.code = $1 LIMIT 1", [code]))[0]!.id;
const projectId = async () => (await sql<{ id: string }>("SELECT id FROM projects WHERE title = $1", [PROJECT]))[0]!.id;
const taskId = async (title: string) => (await sql<{ id: string }>("SELECT id FROM tasks WHERE title = $1 ORDER BY created_at DESC LIMIT 1", [title]))[0]!.id;

async function newTask(page: Page, title: string, code: string) {
  const r = await page.request.post("/api/tasks", { data: { title, lead_department_id: await deptId(code), project_id: await projectId(), due_date: "2027-01-20" } });
  expect(r.status()).toBe(201);
  return ((await r.json()) as { id: string }).id;
}

test("준비 + 실시간 반영: 다른 창에서 업무를 고치면 열린 국서 공간이 새로고침 없이 바뀐다", async ({ page, browser }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  expect((await page.request.post("/api/projects", { data: { title: PROJECT, event_start: "2027-02-10" } })).status()).toBe(201);
  const id = await newTask(page, "실시간 포스터", "promotion");
  await page.goto("/departments/promotion");
  await expect(page.getByRole("link", { name: "실시간 포스터", exact: true })).toBeVisible();

  const other = await (await browser.newContext()).newPage();
  await loginOk(other, E2E.adminEmail, E2E.adminPassword);
  expect((await other.request.patch(`/api/tasks/${id}`, { data: { title: "실시간 포스터 v2" } })).status()).toBe(200);
  // 첫 화면은 손대지 않는다 — 몇 초 안에 자동 반영
  await expect(page.getByRole("link", { name: "실시간 포스터 v2", exact: true })).toBeVisible({ timeout: 20_000 });
  await other.context().close();
});

test("국서 공간: 업무 행에서 바로 삭제 → '되돌리기' / 다시 삭제 → '최근 삭제'에서 되살리기", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await newTask(page, "지울 카드뉴스", "promotion");
  await page.goto("/departments/promotion");
  await page.getByRole("button", { name: "지울 카드뉴스 삭제" }).click();
  await expect(page.getByRole("link", { name: "지울 카드뉴스", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "되돌리기" }).click();
  await expect(page.getByRole("link", { name: "지울 카드뉴스", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "지울 카드뉴스 삭제" }).click();
  await expect(page.getByRole("link", { name: "지울 카드뉴스", exact: true })).toBeHidden();
  const trash = page.getByTestId("trash-panel");
  await trash.locator("summary").click();
  await trash.getByRole("button", { name: "되살리기: 지울 카드뉴스" }).click();
  await expect(page.getByRole("link", { name: "지울 카드뉴스", exact: true })).toBeVisible();
  expect((await sql<{ deleted_at: string | null }>("SELECT deleted_at FROM tasks WHERE id = $1", [await taskId("지울 카드뉴스")]))[0]!.deleted_at).toBeNull();
});

test("검토 화면 '이미 배정' 업무: 마감·업무명 바로 수정, 바로 삭제(대기 제안이 있는 사업)", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await newTask(page, "이미 있는 매뉴얼", "operations");
  const pid = await projectId();
  const term = (await sql<{ term_id: string }>("SELECT term_id FROM projects WHERE id = $1", [pid]))[0]!.term_id;
  await sql("INSERT INTO proposals (id, term_id, source_type, kind, project_key, target_id, payload, dedupe_key, updated_at) VALUES (gen_random_uuid(), $1, 'manual', 'new_task', $2::text, $2::uuid, $3::jsonb, $4, now())", [
    term, pid, JSON.stringify({ title: "새로 제안된 업무", lead_department: "operations", support_departments: [], template_key: null, assignee_ids: [], due_date: null, due_reason: null, due_feasible: true, acceptance_criteria: [], project_id: pid }), `e2e-live-${Date.now()}`,
  ]);
  await page.goto("/review");
  const ops = page.locator(`[data-review-project='${PROJECT}'] [data-review-dept='operations']`);
  const row = ops.locator("[data-existing='이미 있는 매뉴얼']");
  await expect(row).toBeVisible();
  await row.getByLabel("이미 배정 마감: 이미 있는 매뉴얼").fill("2027-01-25");
  await row.getByLabel("이미 배정 마감: 이미 있는 매뉴얼").blur();
  await expect(page.getByText("마감을 바꿨습니다(확정).")).toBeVisible();
  const t = await sql<{ due: string; due_state: string }>("SELECT to_char(due_date,'YYYY-MM-DD') due, due_state FROM tasks WHERE id = $1", [await taskId("이미 있는 매뉴얼")]);
  expect(t[0]).toEqual({ due: "2027-01-25", due_state: "confirmed" });

  await row.getByLabel("이미 배정 업무명: 이미 있는 매뉴얼").fill("당일 집행매뉴얼");
  await row.getByLabel("이미 배정 업무명: 이미 있는 매뉴얼").press("Enter");
  const renamed = ops.locator("[data-existing='당일 집행매뉴얼']");
  await expect(renamed).toBeVisible();
  await renamed.getByRole("button", { name: "이미 배정 업무 삭제: 당일 집행매뉴얼" }).click();
  await expect(renamed).toBeHidden();
  expect((await sql<{ deleted_at: string | null }>("SELECT deleted_at FROM tasks WHERE title = '당일 집행매뉴얼'"))[0]!.deleted_at).not.toBeNull();
});

test("사업 삭제 → 사업 목록 '최근 삭제'에서 되살리기(업무 함께)", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  const pid = await projectId();
  const before = Number((await sql<{ n: string }>("SELECT count(*) n FROM tasks WHERE project_id = $1 AND deleted_at IS NULL", [pid]))[0]!.n);
  await page.goto(`/projects/${pid}`);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "사업 삭제" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("link", { name: PROJECT })).toBeHidden();
  const trash = page.getByTestId("trash-panel");
  await trash.locator("summary").click();
  await trash.getByRole("button", { name: `되살리기: ${PROJECT}` }).click();
  await expect(page.getByRole("link", { name: PROJECT })).toBeVisible();
  expect(Number((await sql<{ n: string }>("SELECT count(*) n FROM tasks WHERE project_id = $1 AND deleted_at IS NULL", [pid]))[0]!.n)).toBe(before);
});
