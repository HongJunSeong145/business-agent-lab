import { expect, test } from "@playwright/test";
import { E2E } from "./fixtures";
import { loginOk } from "./helpers";
import { sql } from "./db";

/**
 * 사용자 지적(2026-11-01): 기획안을 기획국 작업물로 올리고 완료했는데 홍보·집행 레퍼런스가 '기획안 없음'.
 * → 기획안 업무 작업물 = 사업 기획안, 회장·국장 완료 = 결재, 다른 국서 레퍼런스 기준 표시.
 */
test.describe.configure({ mode: "serial" });
const PROJECT = "E2E 기획안 연결 행사";
const PLANNER = "planning.member@demo.kgb.invalid";
const DOC = "행사명: E2E 기획안 연결 행사\n일시: 2027-03-05 12:00\n장소: 본관 로비\n예산: 500,000원\n주최: 학생회\n주관: 기획국\n배급: 선착순 200명, 오프라인 포스터 5장";
const deptId = async (code: string) => (await sql<{ id: string }>("SELECT id FROM departments WHERE code = $1 LIMIT 1", [code]))[0]!.id;

test("기획국원이 기획안 업무에 파일 업로드 → 사업 기획안 탭에 문서 본문 / 회장이 완료 체크 → 결재본, 홍보국 레퍼런스 기준 '기획안 v1 (결재본)'", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  const r = await page.request.post("/api/projects", { data: { title: PROJECT, event_start: "2027-03-05" } });
  const pid = ((await r.json()) as { id: string }).id;
  const plan = ((await (await page.request.post("/api/tasks", { data: { title: "E2E 기획안 작성", lead_department_id: await deptId("planning"), project_id: pid } })).json()) as { id: string }).id;
  const poster = ((await (await page.request.post("/api/tasks", { data: { title: "E2E 기획안 기준 포스터", lead_department_id: await deptId("promotion"), project_id: pid, dependencies: [{ depends_on_task_id: plan, type: "approval_required" }] } })).json()) as { id: string }).id;
  await sql("INSERT INTO task_assignees (task_id, user_id, updated_at) SELECT $1, id, now() FROM users WHERE email = $2 ON CONFLICT DO NOTHING", [plan, PLANNER]);

  // 홍보국 업무 레퍼런스: 아직 기획안 없음
  await page.goto(`/departments/promotion?task=${poster}`);
  await page.getByTestId("task-drawer").getByRole("tab", { name: "레퍼런스" }).click();
  await expect(page.getByTestId("ref-context")).toContainText("기획안 없음");

  // 기획국원이 작업물 탭에서 기획안 파일 업로드
  await page.context().clearCookies();
  await loginOk(page, PLANNER, E2E.demoPassword);
  await page.goto(`/departments/planning?task=${plan}`);
  const drawer = page.getByTestId("task-drawer");
  await drawer.getByRole("tab", { name: "작업물" }).click();
  await drawer.getByLabel("작업물 파일").setInputFiles({ name: "간식 기획안.txt", mimeType: "text/plain", buffer: Buffer.from(DOC, "utf8") });
  await drawer.getByRole("button", { name: "올리기" }).click();
  await expect(page.getByText(/사업 기획안 v1로 반영했습니다/)).toBeVisible();

  await page.goto(`/projects/${pid}#plan`);
  await page.getByTestId("plan-document").locator("summary").click();
  await expect(page.getByTestId("plan-document")).toContainText("선착순 200명");
  await expect(page.getByTestId("plan-panel").getByLabel("장소")).toHaveValue("본관 로비");

  // 회장이 기획안 업무 완료 체크 → 결재본 반영 + 홍보국 업무 착수 가능
  await page.context().clearCookies();
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await page.goto("/departments/planning");
  await page.getByLabel("E2E 기획안 작성 완료").check();
  await expect(page.getByText(/기획안 v1을 결재본으로 반영했습니다/)).toBeVisible();
  expect((await sql<{ status: string }>("SELECT status FROM tasks WHERE id = $1", [poster]))[0]!.status).toBe("todo");

  await page.goto(`/departments/promotion?task=${poster}`);
  await page.getByTestId("task-drawer").getByRole("tab", { name: "레퍼런스" }).click();
  await expect(page.getByTestId("ref-context")).toContainText("기획안 v1 (결재본)");
});
