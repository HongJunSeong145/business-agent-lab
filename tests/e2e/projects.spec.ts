import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./fixtures";
import { loginOk } from "./helpers";
import { sql } from "./db";

/**
 * Phase 3: 사업·업무·국서 공간 — T4, T11, T14, T15(AI 값은 DB 주입), T17
 * 한 사업의 흐름을 순서대로 검증한다.
 */
test.describe.configure({ mode: "serial" });

const PROJECT = "E2E 종강 간식 행사";
const PLAN = "E2E 기획안 결재";
const CARD = "E2E 카드뉴스 제작";
const PROMO_MEMBER = "promotion.member@demo.kgb.invalid"; // 장홍보(홍보국원)

const taskId = async (title: string) => (await sql<{ id: string }>("SELECT id FROM tasks WHERE title = $1 AND deleted_at IS NULL", [title]))[0]!.id;
const row = (page: Page, title: string) => page.locator("li[data-task-id]").filter({ has: page.getByRole("link", { name: title, exact: true }) });

async function addTask(page: Page, o: { title: string; lead: string; support?: string[]; assignee?: string; dep?: { title: string; type: string } }) {
  await page.getByRole("button", { name: "업무 추가" }).click();
  const d = page.getByRole("dialog", { name: "업무 추가" });
  await d.getByLabel("업무명").fill(o.title);
  await d.getByLabel("주관 국서").selectOption({ label: o.lead });
  for (const s of o.support ?? []) await d.getByRole("group", { name: "협조 국서" }).getByLabel(s).check();
  if (o.assignee) await d.getByRole("group", { name: "담당자" }).getByText(o.assignee, { exact: false }).click();
  await d.getByLabel("마감일").fill("2026-12-01");
  if (o.dep) {
    await d.getByLabel("선행 업무 선택").selectOption({ label: `${o.dep.title} (${PROJECT})` });
    await d.getByLabel("의존 유형").selectOption({ label: o.dep.type });
    await d.locator("fieldset").filter({ hasText: "선행 업무" }).getByRole("button").last().click();
  }
  await d.getByRole("button", { name: "업무 추가" }).click();
  await expect(d).toBeHidden();
}

test("회장: 사업 만들기 → 업무 2개(협업·의존) → 사업 보드 (T4)", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await page.goto("/projects");
  await page.getByRole("button", { name: "사업 만들기" }).click();
  const d = page.getByRole("dialog", { name: "사업 만들기" });
  await d.getByLabel("사업명").fill(PROJECT);
  await d.getByLabel("행사 시작일").fill("2026-12-10");
  await d.getByLabel("장소").fill("데모관 로비");
  await d.getByLabel("예상 수혜 인원").fill("150");
  await d.getByRole("checkbox", { name: "학생회비" }).check();
  await d.getByLabel("학생회비 계획 금액").fill("500000");
  await d.getByRole("button", { name: "사업 만들기" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: PROJECT })).toBeVisible();
  await expect(page.getByText("학생회비 500,000원")).toBeVisible();

  await addTask(page, { title: PLAN, lead: "기획국", assignee: "박기획" });
  await addTask(page, { title: CARD, lead: "홍보국", support: ["사무국"], assignee: "장홍보", dep: { title: PLAN, type: "결재 후 착수" } });

  // 협업 업무는 주관(홍보국)·협조(사무국) 두 열에 모두 표시, lead 는 1개
  await expect(page.locator("[data-board-dept=promotion]")).toContainText(CARD);
  await expect(page.locator("[data-board-dept=secretariat]")).toContainText(`${CARD}`);
  await expect(page.locator("[data-board-dept=secretariat]")).toContainText("협조");
  await expect(page.locator("[data-board-dept=promotion]")).toContainText("차단");
  const leads = await sql<{ n: string }>("SELECT count(*) n FROM task_departments WHERE task_id = $1 AND role = 'lead'", [await taskId(CARD)]);
  expect(Number(leads[0]!.n)).toBe(1);
  await expect(page.getByText(`${PLAN} → ${CARD}`)).toBeVisible();
});

test("국서 공간: 협업 업무가 두 국서에 표시, 차단 사유 표시 (T4·D7)", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await page.goto("/departments/promotion");
  await expect(page.getByRole("heading", { level: 1, name: "홍보국" })).toBeVisible();
  await expect(row(page, CARD).getByTestId("blocked-reason")).toHaveText(`'${PLAN}' 결재 대기`);
  await expect(row(page, CARD).getByRole("checkbox")).toBeDisabled();
  await page.goto("/departments/secretariat");
  await expect(row(page, CARD)).toBeVisible();
  await expect(row(page, CARD)).toContainText("사무국· 협조");
  await expect(row(page, CARD)).toContainText("홍보국· 주관");
});

test("T15: AI 72% → 완료 체크 100%(실행 취소 가능) → 후속 차단 해제 → 해제 시 72% 복귀", async ({ page }) => {
  await sql("UPDATE tasks SET ai_progress = 72, status = 'in_progress' WHERE id = $1", [await taskId(PLAN)]);
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await page.goto("/departments/planning");
  const r = row(page, PLAN);
  await expect(r.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "72");
  await expect(r).toContainText("AI");

  // 완료 → 실행 취소
  await r.getByRole("checkbox").check();
  await expect(r.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await page.getByRole("button", { name: "실행 취소" }).click();
  await expect(r.getByRole("checkbox")).not.toBeChecked();
  await expect(r.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "72");

  // 다시 완료 → DB·후속 업무 확인
  await r.getByRole("checkbox").check();
  await expect(r.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await expect.poll(async () => (await sql<{ e: number }>("SELECT effective_progress e FROM task_progress WHERE task_id = $1", [await taskId(PLAN)]))[0]!.e).toBe(100);
  await expect.poll(async () => (await sql<{ status: string }>("SELECT status FROM tasks WHERE id = $1", [await taskId(CARD)]))[0]!.status).toBe("todo");
  await page.goto("/departments/promotion");
  await expect(row(page, CARD).getByTestId("blocked-reason")).toHaveCount(0);

  // 드로어 이력: AI 평가 72% / 사용자 완료 확정, 완료 해제 시 72% 복귀
  await page.goto("/departments/planning");
  await row(page, PLAN).getByRole("link", { name: PLAN, exact: true }).click();
  const drawer = page.getByTestId("task-drawer");
  await drawer.getByRole("tab", { name: "이력" }).click();
  await expect(drawer).toContainText("완료 체크 (AI 평가 72% / 사용자 완료 확정)");
  await drawer.getByRole("tab", { name: "개요" }).click();
  await drawer.getByRole("checkbox", { name: "완료" }).uncheck();
  await expect(drawer.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "72");
  await expect.poll(async () => (await sql<{ is_completed: boolean }>("SELECT is_completed FROM tasks WHERE id = $1", [await taskId(PLAN)]))[0]!.is_completed).toBe(false);
  await drawer.getByRole("checkbox", { name: "완료" }).check();
  await expect(drawer.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  // 화면은 낙관적으로 바로 바뀌므로 서버 저장 완료까지 확인
  await expect.poll(async () => (await sql<{ is_completed: boolean }>("SELECT is_completed FROM tasks WHERE id = $1", [await taskId(PLAN)]))[0]!.is_completed).toBe(true);
  await expect(page.getByText("완료 처리했습니다.")).toBeVisible();
});

test("T14·T11: 홍보국원이 자기 업무 진척 40%(수동) → 새로고침 유지, AI 재평가가 덮어쓰지 않음 → 사무국 화면에서도 40%", async ({ page }) => {
  await loginOk(page, PROMO_MEMBER, E2E.demoPassword);
  await page.goto("/departments/promotion");
  const r = row(page, CARD);
  await r.getByRole("button", { name: /진척도 .* 조정/ }).click();
  await page.getByLabel("진척도 직접 조정").fill("40");
  await page.getByRole("button", { name: "진척도 적용" }).click();
  await expect(r.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  await expect(r).toContainText("수동");
  await page.reload();
  await expect(row(page, CARD).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");

  // AI 재평가 시뮬레이션: ai_progress 만 바뀌고 표시값은 수동 40 유지
  await sql("UPDATE tasks SET ai_progress = 90 WHERE id = $1", [await taskId(CARD)]);
  await page.goto("/departments/secretariat");
  await expect(row(page, CARD).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  const h = await sql<{ field: string; new_value: string }>("SELECT field, new_value FROM progress_history WHERE task_id = $1 AND field = 'manual'", [await taskId(CARD)]);
  expect(h.map((x) => x.new_value)).toEqual(["40"]);
});

test("국원 권한: 남의 업무는 체크 불가, 업무 추가·사업 만들기 없음, 수정 API 403", async ({ page }) => {
  await loginOk(page, PROMO_MEMBER, E2E.demoPassword);
  await page.goto("/departments/planning");
  await expect(row(page, PLAN).getByRole("checkbox")).toBeDisabled();
  await expect(page.getByRole("button", { name: "업무 추가" })).toHaveCount(0);
  await page.goto("/projects");
  await expect(page.getByRole("button", { name: "사업 만들기" })).toHaveCount(0);
  const res = await page.request.patch(`/api/tasks/${await taskId(PLAN)}`, { data: { title: "무단 변경" } });
  expect(res.status()).toBe(403);
  const res2 = await page.request.post(`/api/tasks/${await taskId(PLAN)}/complete`, { data: { completed: false } });
  expect(res2.status()).toBe(403);
});

test("업무 드로어: 업무명·마감(확정)·완료 기준 편집, 이력 기록", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await page.goto(`/departments/promotion?task=${await taskId(CARD)}`);
  const drawer = page.getByTestId("task-drawer");
  await drawer.getByLabel("업무명").fill(`${CARD} (4장)`);
  await drawer.getByLabel("업무명").press("Enter");
  await expect(page.getByRole("dialog")).toContainText(`${CARD} (4장)`);
  await drawer.getByLabel("마감일").fill("2026-11-27");
  await drawer.getByLabel("마감일").blur();
  await expect(drawer).toContainText("사용자 지정");
  await drawer.getByLabel("완료 기준 추가").fill("행사 일시·장소 포함");
  await drawer.getByRole("button", { name: "추가", exact: true }).click();
  await expect(drawer.getByRole("checkbox", { name: "완료 기준: 행사 일시·장소 포함" })).toBeVisible();
  await drawer.getByRole("tab", { name: "이력" }).click();
  await expect(drawer).toContainText("업무 수정: 마감 → 2026-11-27");
  await expect(drawer).toContainText("수동 진척도 -% → 40%");
  const db = await sql<{ title: string; due: string; due_state: string }>("SELECT title, to_char(due_date,'YYYY-MM-DD') due, due_state FROM tasks WHERE id = $1", [await taskId(`${CARD} (4장)`)]);
  expect(db[0]).toEqual({ title: `${CARD} (4장)`, due: "2026-11-27", due_state: "confirmed" });
});

test("대시보드: 가장 가까운 사업 진척도 막대 + 국서 카드 → 국서 공간", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  const bar = page.getByTestId("project-progress");
  await expect(page.getByRole("link", { name: PROJECT })).toBeVisible();
  // 기획국 100%(가중 1) + 홍보국 40%(가중 1) → 70%
  await expect(bar.getByLabel("사업 전체 진척도")).toHaveText("70%");
  await expect(bar.getByRole("progressbar", { name: "기획국 100%" })).toBeVisible();
  await expect(bar.getByRole("progressbar", { name: "홍보국 40%" })).toBeVisible();
  await page.locator("[data-dept=promotion]").getByRole("link", { name: "홍보국" }).click();
  await expect(page).toHaveURL(/\/departments\/promotion$/);
});

test("T17: 사업 취소 → 미완료 업무 취소, 완료 업무·증빙 보존, 목록 취소선", async ({ page }) => {
  const pid = (await sql<{ id: string }>("SELECT id FROM projects WHERE title = $1", [PROJECT]))[0]!.id;
  const admin = (await sql<{ id: string }>("SELECT id FROM users WHERE email = $1", [E2E.adminEmail]))[0]!.id;
  await sql("INSERT INTO evidence_items (id, project_id, storage_key, uploaded_by, updated_at) VALUES (gen_random_uuid(), $1, 'evidence/2026/12/0192f0a0-0000-7000-8000-00000000e2e1', $2, now())", [pid, admin]);
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await page.goto(`/projects/${pid}`);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "사업 취소" }).click();
  await expect(page.getByText("취소된 사업입니다.")).toBeVisible();
  const tasks = await sql<{ title: string; status: string }>("SELECT title, status FROM tasks WHERE project_id = $1 ORDER BY title", [pid]);
  expect(tasks).toEqual([{ title: PLAN, status: "done" }, { title: `${CARD} (4장)`, status: "cancelled" }]);
  expect((await sql("SELECT 1 FROM evidence_items WHERE project_id = $1", [pid])).length).toBe(1);
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: PROJECT })).toHaveClass(/line-through/);
});
