import { expect, test } from "@playwright/test";
import { E2E } from "./fixtures";
import { loginOk } from "./helpers";
import { sql } from "./db";

/** Phase 9: 분기 예결산(T9)·구입·증빙(T20)·모니터링 수동 실행·제휴 진행표 */
test.describe.configure({ mode: "serial" });
const FIN = "finance.member@demo.kgb.invalid"; // 정재정
const SEC = "secretariat.member@demo.kgb.invalid"; // 조사무
const PROJECT = "E2E 재정 간식 나눔";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const projectId = async () => (await sql<{ id: string }>("SELECT id FROM projects WHERE title = $1", [PROJECT]))[0]!.id;

test("준비: 학생회비 사업(수혜 80명)", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  const r = await page.request.post("/api/projects", { data: { title: PROJECT, event_start: "2027-02-01", expected_beneficiaries: 80, funding: [{ source: "student_fee", amount_planned: 300000 }] } });
  expect(r.status()).toBe(201);
});

test("T9: 재정국원이 4분기 교비 라인 1,000,000원 추가 → 세금 100,000·총액 1,100,000, CSV 내보내기", async ({ page }) => {
  await loginOk(page, FIN, E2E.demoPassword);
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "재정" }).click();
  await page.getByRole("navigation", { name: "분기" }).getByRole("link", { name: "4분기" }).click();
  await expect(page.getByText("지금 3·4분기 심사")).toBeVisible();
  const form = page.getByRole("form", { name: "예산 라인 추가" });
  await form.getByLabel("라인 재원").selectOption("school");
  await form.getByLabel("라인 항목").fill("E2E 무대 대여");
  await form.getByLabel("라인 계획액").fill("1000000");
  await form.getByRole("button", { name: "추가" }).click();
  const row = page.locator("tr[data-line='E2E 무대 대여']");
  await expect(row).toContainText("1,000,000");
  await expect(row).toContainText("100,000");
  await expect(row).toContainText("1,100,000");
  const csv = await page.request.get("/api/finance/export?quarter=4");
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const text = await csv.text();
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain("E2E 무대 대여,1000000,100000,1100000");
});

test("T20: 구입 완료 → 영수증 누락 표시 → 업로드하면 사라짐 / 명단 필수(80명) 체크리스트", async ({ page }) => {
  await loginOk(page, FIN, E2E.demoPassword);
  await page.goto(`/projects/${await projectId()}#finance`);
  const panel = page.getByTestId("project-finance");
  await expect(panel.locator("[data-evidence='beneficiary_roster']")).toContainText("필수");
  const form = panel.getByRole("form", { name: "구입 항목 추가" });
  await form.getByLabel("품목").fill("E2E 과자");
  await form.getByLabel("수량").fill("80");
  await form.getByLabel("단가").fill("3000");
  await form.getByRole("button", { name: "추가" }).click();
  const item = panel.locator("[data-purchase='E2E 과자']");
  await expect(item).toContainText("240,000원");
  await item.getByLabel("E2E 과자 상태").selectOption("purchased");
  await expect(item.getByRole("status")).toHaveText("영수증·이체내역이 없습니다");
  await item.getByLabel("E2E 과자 영수증 파일").setInputFiles({ name: "영수증.png", mimeType: "image/png", buffer: PNG });
  await expect(item.getByRole("link", { name: "영수증.png" })).toBeVisible();
  await expect(item.getByRole("status")).toHaveCount(0);
  await item.getByRole("button", { name: "검수", exact: true }).click();
  await expect(item).toContainText("검수 정재정");
});

test("모니터링 '지금 점검' → 알림 생성 + 사무국 노티스", async ({ page }) => {
  await sql("UPDATE purchase_items SET status = 'purchased', purchased_at = now() - interval '1 day' WHERE name = 'E2E 과자'");
  await sql("UPDATE evidence_items SET deleted_at = now() WHERE original_name = '영수증.png'");
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await page.goto("/finance#monitor");
  await page.getByRole("button", { name: "지금 점검" }).click();
  await expect(page.getByText(/점검 완료: 발견 \d+건/)).toBeVisible();
  await expect(page.getByTestId("monitor-last")).toContainText("최근 점검");
  await expect(page.getByTestId("evidence-board")).toContainText("영수증·이체내역 없음");
  const [n] = await sql<{ n: string }>("SELECT count(*) n FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = $1 AND n.type = 'monitor_receipt_missing'", [FIN]);
  expect(Number(n!.n)).toBe(1);
  const [notice] = await sql<{ n: string }>("SELECT count(*) n FROM notifications WHERE type IN ('monitor_daily','monitor_weekly')");
  expect(Number(notice!.n)).toBeGreaterThan(0);
});

test("제휴 진행표: 사무국원이 후보 추가 → 문의함으로 바꾸면 마지막 연락일 기록", async ({ page }) => {
  await loginOk(page, SEC, E2E.demoPassword);
  await page.goto(`/projects/${await projectId()}#partners`);
  const p = page.getByTestId("partners");
  const f = p.getByRole("form", { name: "제휴 후보 추가" });
  await f.getByLabel("업체명").fill("E2E 카페");
  await f.getByLabel("웹사이트").fill("https://example.com");
  await f.getByRole("button", { name: "추가" }).click();
  await p.getByLabel("E2E 카페 상태").selectOption("contacted");
  await expect(p.getByRole("row", { name: /E2E 카페/ })).toContainText(/\d{4}\. ?\d{1,2}\. ?\d{1,2}/);
});
