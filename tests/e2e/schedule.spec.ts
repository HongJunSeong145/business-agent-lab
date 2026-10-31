import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./fixtures";
import { loginOk } from "./helpers";
import { sql } from "./db";

/** Phase 4: 규칙 엔진·캘린더 — T5, T6, T9, T10, T16 + 캘린더 드래그 (오늘 = 2026-10-31 고정) */
test.describe.configure({ mode: "serial" });

const P5 = "E2E 교비 종강 행사";
const P6 = "E2E 급한 교비 행사";

async function createProject(page: Page, o: { title: string; date: string; school?: string; vendor?: boolean }) {
  await page.goto("/projects");
  await page.getByRole("button", { name: "사업 만들기" }).click();
  const d = page.getByRole("dialog", { name: "사업 만들기" });
  await d.getByLabel("사업명").fill(o.title);
  await d.getByLabel("행사 시작일").fill(o.date);
  if (o.school) {
    await d.getByRole("checkbox", { name: "교비" }).check();
    await d.getByLabel("교비 계획 금액").fill(o.school);
  }
  if (o.vendor) await d.getByLabel("외부업체·대행사 이용").check();
  await d.getByRole("button", { name: "사업 만들기" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
}

async function applyTemplate(page: Page) {
  await page.getByRole("button", { name: "표준 업무 만들기" }).click();
  const d = page.getByRole("dialog", { name: "표준 업무 만들기" });
  await expect(d.getByRole("list", { name: "표준 업무 목록" }).getByRole("listitem")).not.toHaveCount(0);
  await d.getByRole("button", { name: /건 만들기$/ }).click();
  await expect(d).toBeHidden();
}

const taskDue = async (project: string, key: string) =>
  (await sql<{ due: string | null; due_state: string }>(
    "SELECT to_char(t.due_date,'YYYY-MM-DD') due, t.due_state FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.title = $1 AND t.template_key = $2",
    [project, key],
  ))[0]!;

test("T10: 학사일정으로 분기 계산·저장 → 대시보드 캘린더가 오늘 포함 분기로 열림", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await page.goto("/settings/term");
  await page.getByLabel("중앙선거 종료(당선 확정)").fill("2025-11-27");
  await page.getByLabel("1학기 개강").fill("2026-03-02");
  await page.getByLabel("1학기 종강").fill("2026-06-19");
  await page.getByLabel("2학기 개강").fill("2026-09-01");
  await page.getByLabel("다음 선거 확정").fill("2026-12-20");
  await page.getByRole("button", { name: "분기 계산" }).click();
  await expect(page.locator("#q3_start")).toHaveValue("2026-06-20");
  await expect(page.locator("#q4_end")).toHaveValue("2026-12-20");
  await page.getByLabel("제N대").fill("7");
  await page.getByLabel("배너 제목").fill("제7대 데모 학생회");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("기수 설정을 저장했습니다.")).toBeVisible();
  await expect(page.getByText("기수·분기 변경")).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("제7대 데모 학생회");
  const tab = page.getByTestId("quarter-calendar").locator("..").getByRole("tab", { selected: true });
  await expect(tab).toContainText("4분기");
  await expect(tab).toContainText("09.01~12.20");
  await expect(page.locator(".fc-toolbar-title")).toHaveText("2026년 10월");
});

test("T5·T9: 교비 + 외부업체 사업 → 세금 포함 총액, 표준 업무, 송부 11/19·업체 확정 11/12, 불가 대안", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await createProject(page, { title: P5, date: "2026-12-10", school: "1000000", vendor: true });
  await expect(page.getByTestId("funding")).toContainText("교비 1,000,000원 + 세금 10% 100,000원 = 세금 포함 1,100,000원");
  await expect(page.getByTestId("evidence-requirements")).toContainText("공문");
  await applyTemplate(page);
  await expect(page.getByText("표준 업무 15건을 만들었습니다.")).toBeVisible();
  expect(await taskDue(P5, "VENDOR_CONFIRM")).toEqual({ due: "2026-11-12", due_state: "proposed" });
  expect((await taskDue(P5, "PLN_APPROVAL")).due).toBe("2026-11-05");
  const panel = page.getByTestId("schedule-panel");
  await expect(panel).toContainText("행정실 송부 마감: 2026-11-19");
  await expect(panel.getByTestId("infeasible")).toContainText("(c) 행사를 미루면 가능한 가장 빠른 날: 2026-12-14");
  await expect(panel.getByTestId("infeasible")).toContainText("(b) 교비 → 학생회비로 바꾸면(행정실 21일 제약 없음): 가능");
});

test("대시보드 30일 일정: 송부 마일스톤 표시, 제안 마감 '승인' → 확정", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  const list = page.getByTestId("upcoming-list");
  await expect(list).toContainText("행정실 송부 마감(D-21)");
  await list.getByRole("button", { name: "외부업체·대행사 견적 및 확정 마감 확정" }).click();
  await expect(page.getByText("마감을 확정했습니다.")).toBeVisible();
  await expect.poll(async () => (await taskDue(P5, "VENDOR_CONFIRM")).due_state).toBe("confirmed");
  await expect(list.locator("[data-upcoming='외부업체·대행사 견적 및 확정']")).toContainText("확정");
});

test("캘린더: 제안 마감을 드래그로 옮기면 확인 후 확정 마감으로 저장", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await page.locator(".fc-next-button").click();
  await expect(page.locator(".fc-toolbar-title")).toHaveText("2026년 11월");
  const ev = page.locator(".fc-event", { hasText: "기획안 검토 및 결재" });
  await expect(ev).toHaveClass(/kgb-proposed/);
  const target = page.locator('.fc-daygrid-day[data-date="2026-11-04"] .fc-daygrid-day-frame');
  const from = (await ev.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 5, from.y + from.height / 2 + 5, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 10, { steps: 15 });
  await page.mouse.up();
  const dialog = page.getByRole("dialog", { name: "마감을 바꿀까요?" });
  await expect(dialog).toContainText("2026-11-05 → 2026-11-04");
  await dialog.getByRole("button", { name: "바꾸기" }).click();
  await expect.poll(async () => taskDue(P5, "PLN_APPROVAL")).toEqual({ due: "2026-11-04", due_state: "confirmed" });
  await expect(page.locator(".fc-event", { hasText: "기획안 검토 및 결재" })).toHaveClass(/kgb-confirmed/);
});

test("T16: 행사일 변경 → 제안 마감만 재계산, 확정 마감 유지 + 충돌 경고 → 일괄 재계산", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  const opsBefore = (await taskDue(P5, "OPS_MANUAL")).due;
  expect(opsBefore).toBe("2026-12-03");
  const pid = (await sql<{ id: string }>("SELECT id FROM projects WHERE title = $1", [P5]))[0]!.id;
  await page.goto(`/projects/${pid}`);
  await page.getByRole("button", { name: "정보 수정" }).click();
  const d = page.getByRole("dialog", { name: "사업 정보 수정" });
  await d.getByLabel("행사 시작일").fill("2026-11-26");
  await d.getByRole("button", { name: "저장" }).click();
  await expect(d).toBeHidden();
  // 제안 마감은 재계산
  await expect.poll(async () => (await taskDue(P5, "OPS_MANUAL")).due).toBe("2026-11-19");
  // 확정 마감(업체 확정 11/12, 결재 11/04)은 유지 — 새 규칙(송부 11/05, 업체 ≤ 10/29)보다 늦어 충돌
  expect(await taskDue(P5, "VENDOR_CONFIRM")).toEqual({ due: "2026-11-12", due_state: "confirmed" });
  const conflicts = page.getByTestId("conflicts");
  await expect(conflicts).toContainText("외부업체·대행사 견적 및 확정: 확정 11/12 → 늦어도 10/29");

  await page.getByRole("button", { name: "일괄 재계산" }).click();
  await page.getByRole("dialog", { name: /다시 계산할까요/ }).getByRole("button", { name: "일괄 재계산" }).click();
  await expect(page.getByText(/마감 \d+건을 다시 계산했습니다/)).toBeVisible();
  await expect(page.getByTestId("conflicts")).toHaveCount(0);
  const v = await taskDue(P5, "VENDOR_CONFIRM");
  expect(v.due_state).toBe("proposed");
  expect(v.due).toBeNull(); // 새 최종 마감(10/29)은 이미 지나 과거 날짜를 만들지 않음
});

test("T6: 행사일 11/10 교비 → 불가 표시, 대안(학생회비 전환 불가·연기 최단 12/01), 과거 날짜 미생성 / 취소 시 캘린더 취소선", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await createProject(page, { title: P6, date: "2026-11-10", school: "0" });
  await applyTemplate(page);
  const box = page.getByTestId("infeasible");
  await expect(box).toContainText("(b) 교비 → 학생회비로 바꾸면(행정실 21일 제약 없음): 불가");
  await expect(box).toContainText("(c) 행사를 미루면 가능한 가장 빠른 날: 2026-12-01");
  await expect(page.getByTestId("schedule-panel")).toContainText("2026-10-20 (이미 지남)");
  const past = await sql("SELECT 1 FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.title = $1 AND t.due_date < '2026-10-31'", [P6]);
  expect(past).toHaveLength(0);
  expect(await sql("SELECT 1 FROM schedule_events e JOIN projects p ON p.id = e.project_id WHERE p.title = $1", [P6])).toHaveLength(0);

  page.once("dialog", (dlg) => void dlg.accept());
  await page.getByRole("button", { name: "사업 취소" }).click();
  await expect(page.getByText("취소된 사업입니다.")).toBeVisible();
  await page.goto("/");
  await page.locator(".fc-next-button").click();
  const ev = page.locator(".fc-event", { hasText: P6 });
  await expect(ev.locator("span").first()).toHaveClass(/line-through/);
});

test("규칙 파라미터·휴일 설정 저장 → 이력", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await page.goto("/settings/rules");
  await expect(page.getByRole("list", { name: "휴일 목록" })).toContainText("한글날");
  await page.getByLabel(/수혜자 명단 필수 기준/).fill("50");
  await page.getByLabel("휴일 날짜").fill("2026-11-20");
  await page.getByLabel("휴일 이름").fill("개교기념일");
  await page.getByRole("button", { name: "휴일 추가" }).click();
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText(/규칙 설정을 저장했습니다/)).toBeVisible();
  await expect(page.getByText(/규칙 파라미터·휴일 변경/)).toBeVisible();
  const s = await sql<{ value: unknown }>("SELECT value FROM settings WHERE key = 'ROSTER_THRESHOLD'");
  expect(s[0]!.value).toBe(50);
});
