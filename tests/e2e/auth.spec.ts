import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./fixtures";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
}

/** 로그인 성공까지 기다린다(서버 액션 완료 전에 이동하면 로그인이 취소됨) */
async function loginOk(page: Page, email: string, password: string) {
  await login(page, email, password);
  await expect(page).toHaveURL(/\/$/);
}

/** Next.js 라우트 안내 영역(role=alert)과 구분하기 위해 폼 메시지만 선택 */
const formAlert = (page: Page) => page.locator("p[role='alert']");

test("로그인하지 않으면 모든 페이지가 로그인 화면으로 이동", async ({ page }) => {
  for (const path of ["/", "/settings", "/settings/members"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
  const res = await page.request.get("/api/drawer?type=task&id=00000000-0000-0000-0000-000000000000");
  expect(res.status()).toBe(401);
});

test("관리자 로그인 → 대시보드 셸이 지시서 순서대로 실제 데이터로 표시", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);

  const banner = page.getByRole("region", { name: "학생회 배너" });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("heading", { level: 1 })).toHaveText("제1대 학생회");

  // 섹션 순서(8-2): 배너 → 최근 회의록 → 분기 캘린더 → 30일 → 사업 진척도 → 국서 카드 → 인적사항 → 연락망
  const headings = await page.locator("main h1, main h2, main section[aria-label='국서 현황']").evaluateAll((els) =>
    els.map((e) => (e.tagName === "SECTION" ? "국서 현황" : e.textContent?.trim())),
  );
  expect(headings).toEqual([
    "제1대 학생회", "최근 회의록", "분기 캘린더", "향후 30일 일정", "가장 가까운 사업 진척도", "국서 현황", "학생회 인적사항", "외부 연락망",
  ]);

  // 국서 카드 5개, 좌→우 순서 고정 (D13)
  const depts = await page.locator("[data-dept]").evaluateAll((els) => els.map((e) => e.getAttribute("data-dept")));
  expect(depts).toEqual(["planning", "finance", "secretariat", "promotion", "operations"]);
  await expect(page.locator("[data-dept] h3")).toHaveText(["기획국", "재정국", "사무국", "홍보국", "집행국"]);

  // 오늘(KST) 포함 분기 탭이 선택됨
  await expect(page.getByRole("tab", { selected: true })).toHaveCount(1);

  // 인적사항·연락망은 DB 데모 데이터 + '데모 데이터' 표시
  await expect(page.getByRole("cell", { name: "김데모" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /데모대학교 행정실/ })).toBeVisible();
  expect(await page.getByText("데모 데이터").count()).toBeGreaterThan(0);
});

test("잘못된 비밀번호는 거부되고, 5회 실패 후에는 잠긴다", async ({ page }) => {
  const email = "nobody-rate-limit@e2e.test";
  for (let i = 0; i < 5; i++) {
    await login(page, email, "wrong-password-xx");
    await expect(formAlert(page)).toHaveText("이메일 또는 비밀번호가 올바르지 않습니다.");
  }
  await login(page, email, "wrong-password-xx");
  await expect(formAlert(page)).toHaveText(/로그인 시도가 너무 많습니다/);
});

test("초대 → 가입 → 국원 권한 확인 → 로그아웃", async ({ page, browser }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await page.goto("/settings/members");
  await page.getByLabel("이메일").fill("new.member@e2e.test");
  await page.getByLabel("역할").selectOption("member");
  await page.getByLabel("국서").selectOption({ label: "홍보국" });
  await page.getByRole("button", { name: "초대 링크 만들기" }).click();
  const link = await page.getByTestId("invite-link").inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}$/);
  await expect(page.getByText("new.member@e2e.test · 국원 · 홍보국")).toBeVisible();

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto(link);
  await expect(p2.getByText("홍보국 · 국원(으)로 초대되었습니다.")).toBeVisible();
  await p2.getByLabel("이름").fill("신입국원");
  await p2.getByLabel("비밀번호 (10자 이상)").fill("short");
  await p2.getByLabel("비밀번호 확인").fill("short");
  // 브라우저 minLength 검증을 우회해 서버 검증 확인
  await p2.locator("form").evaluate((f) => f.querySelectorAll("input").forEach((i) => i.removeAttribute("minlength")));
  await p2.getByRole("button", { name: "가입하고 시작하기" }).click();
  await expect(formAlert(p2)).toHaveText("비밀번호는 10자 이상이어야 합니다.");

  await p2.getByLabel("비밀번호 (10자 이상)").fill("member-password-1");
  await p2.getByLabel("비밀번호 확인").fill("member-password-1");
  await p2.getByRole("button", { name: "가입하고 시작하기" }).click();
  await expect(p2).toHaveURL(/\/$/);
  await expect(p2.getByRole("button", { name: "사용자 메뉴" })).toContainText("신입국원");

  // 국원: 회원 관리 메뉴 없음 + 직접 접근 시 404 (UI 숨김 + 서버 강제)
  await p2.getByRole("button", { name: "사용자 메뉴" }).click();
  await expect(p2.getByRole("menuitem", { name: /회원·초대 관리/ })).toHaveCount(0);
  await p2.keyboard.press("Escape");
  const res = await p2.goto("/settings/members");
  expect(res?.status()).toBe(404);

  // 같은 링크 재사용 불가
  const p3 = await (await browser.newContext()).newPage();
  await p3.goto(link);
  await expect(formAlert(p3)).toHaveText(/이미 사용된 초대 링크/);

  // 로그아웃
  await p2.goto("/");
  await p2.getByRole("button", { name: "사용자 메뉴" }).click();
  await p2.getByRole("menuitem", { name: "로그아웃" }).click();
  await expect(p2).toHaveURL(/\/login$/);
  await p2.goto("/");
  await expect(p2).toHaveURL(/\/login$/);
  await ctx.close();
});

test("비밀번호 변경 시 다른 기기의 세션도 무효화", async ({ page, browser }) => {
  const email = "president@demo.kgb.invalid";
  await loginOk(page, email, E2E.demoPassword);

  const other = await (await browser.newContext()).newPage();
  await loginOk(other, email, E2E.demoPassword);

  await page.goto("/settings/account");
  await page.getByLabel("현재 비밀번호").fill(E2E.demoPassword);
  await page.getByLabel("새 비밀번호 (10자 이상)").fill("president-new-pw-1");
  await page.getByLabel("새 비밀번호 확인").fill("president-new-pw-1");
  await page.getByRole("button", { name: "비밀번호 변경" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // 다른 기기: 쿠키는 남아 있지만 session_version 불일치로 로그인 화면으로
  await other.goto("/");
  await expect(other).toHaveURL(/\/login$/);

  await login(page, email, "president-new-pw-1");
  await expect(page).toHaveURL(/\/$/);
});

test("업무 드로어: URL 쿼리로 열리고, 없는 항목은 안내", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await page.goto("/?task=00000000-0000-0000-0000-000000000000");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[role=alert]")).toHaveText("항목을 찾을 수 없습니다.");
  await dialog.getByRole("button", { name: "닫기" }).click();
  await expect(page).toHaveURL(/\/$/);
});
