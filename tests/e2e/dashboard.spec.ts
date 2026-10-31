import { expect, test } from "@playwright/test";
import { E2E } from "./fixtures";
import { loginOk } from "./helpers";
import { sql } from "./db";

/** Phase 8: 인적사항(T21)·연락망(T22)·배너·전역 검색·알림 벨·대시보드에서 업무 상세 2클릭(T26) */
test.describe.configure({ mode: "serial" });
const PROMO = "promotion.member@demo.kgb.invalid"; // 장홍보

test("T21: 국원은 남의 행 입력이 비활성 + API 403, 자기 행은 고치면 새로고침 후에도 유지", async ({ page }) => {
  await loginOk(page, PROMO, E2E.demoPassword);
  const table = page.getByRole("table", { name: "학생회 인적사항" });
  await expect(table.getByLabel("김데모 연락처")).toBeDisabled();
  await expect(page.getByRole("form", { name: "인적사항 추가" })).toHaveCount(0);
  const mine = table.getByLabel("장홍보 학과");
  await expect(mine).toBeEnabled();
  await mine.fill("E2E 전공");
  await mine.press("Enter");
  await expect(page.getByText("저장했습니다.")).toBeVisible();
  await page.reload();
  await expect(table.getByLabel("장홍보 학과")).toHaveValue("E2E 전공");
  const [other] = await sql<{ id: string }>("SELECT id FROM member_profiles WHERE name = '김데모'");
  expect((await page.request.patch(`/api/profiles/${other!.id}`, { data: { phone: "010-0000-0000" } })).status()).toBe(403);
  expect((await page.request.post("/api/contacts/columns", { data: { label: "몰래" } })).status()).toBe(403);
});

test("T22: 회장이 연락망 열 추가·이름 변경·삭제·되돌리기 → 새로고침 후 유지, 값 보존", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  const card = page.locator("#contacts");
  await card.getByLabel("새 열 이름").fill("제휴 조건");
  await card.getByRole("button", { name: "열 추가" }).click();
  await expect(card.getByLabel("열 이름: 제휴 조건")).toBeVisible();
  const cell = card.getByLabel("연락처 1 제휴 조건");
  await cell.fill("10% 할인");
  await cell.press("Enter");
  await expect(page.getByText("저장했습니다.")).toBeVisible();
  const head = card.getByLabel("열 이름: 제휴 조건");
  await head.fill("제휴 혜택");
  await head.press("Enter");
  await expect(card.getByLabel("열 이름: 제휴 혜택")).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await card.getByRole("button", { name: "열 삭제: 제휴 혜택" }).click();
  await expect(card.getByRole("button", { name: "열 되돌리기: 제휴 혜택" })).toBeVisible();
  await page.reload();
  await expect(card.getByLabel("열 이름: 제휴 혜택")).toHaveCount(0);
  await card.getByRole("button", { name: "열 되돌리기: 제휴 혜택" }).click();
  await expect(card.getByLabel("연락처 1 제휴 혜택")).toHaveValue("10% 할인");
  await page.reload();
  await expect(card.getByLabel("연락처 1 제휴 혜택")).toHaveValue("10% 할인");
});

test("배너 편집(제목·부제·사진) → 대시보드에 반영", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  const banner = page.getByRole("region", { name: "학생회 배너" });
  await banner.getByRole("button", { name: "배너 편집" }).click();
  const d = page.getByRole("dialog", { name: "배너 편집" });
  await d.getByLabel("부제").fill("E2E 함께 만드는 학생회");
  await d.getByLabel(/사진/).setInputFiles({ name: "b.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
  await d.getByRole("button", { name: "저장" }).click();
  await expect(d).toBeHidden();
  await expect(banner).toContainText("E2E 함께 만드는 학생회");
  await expect(banner).toHaveAttribute("data-has-image", "true");
  const url = (await banner.evaluate((e) => getComputedStyle(e).backgroundImage)).match(/url\("?(.*?)"?\)/)![1]!;
  expect((await page.request.get(url)).headers()["content-type"]).toBe("image/png");
});

test("전역 검색 → Enter 로 업무 상세 / 알림 벨 → 목록·모두 읽음 / T26 대시보드 국서 카드에서 2클릭 안에 업무 상세", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  const box = page.getByRole("combobox", { name: "전역 검색" });
  await box.fill("카드뉴스");
  const results = page.getByRole("listbox", { name: "검색 결과" });
  await expect(results.getByRole("option").first()).toBeVisible();
  await expect(results).toContainText("업무");
  await box.press("Enter");
  await expect(page.getByTestId("task-drawer")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/");
  const bell = page.getByRole("button", { name: /^알림 \(읽지 않은 알림/ });
  await bell.click();
  await expect(page.getByRole("list", { name: "알림 목록" }).getByRole("listitem").first()).toBeVisible();
  const read = page.getByRole("button", { name: "모두 읽음" });
  if (await read.count()) {
    await read.click();
    await expect(bell).toHaveAccessibleName("알림 (읽지 않은 알림 0건)");
  }
  await page.keyboard.press("Escape");

  // T26: 국서 카드의 급한 업무 1클릭 → 업무 상세
  const cardTask = page.locator("[data-dept] a[href*='?task=']").first();
  await expect(cardTask).toBeVisible();
  await cardTask.click();
  await expect(page.getByTestId("task-drawer")).toBeVisible();
});
