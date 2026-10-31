import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./fixtures";
import { formAlert, loginOk } from "./helpers";

const FX = (name: string) => path.resolve("tests/fixtures/minutes", name);
/** 추출 완료 이후 상태 — Phase 5부터 추출이 끝나면 AI 분석(mock)으로 이어진다 */
const DONE = /추출 완료|분석 중|검토 대기|완료/;

async function uploadFile(page: Page, name: string, title?: string) {
  await page.getByRole("button", { name: "회의록 업로드" }).click();
  const dialog = page.getByRole("dialog", { name: "회의록 올리기" });
  await dialog.getByLabel("회의록 파일").setInputFiles(FX(name));
  await expect(dialog.getByTestId("picked-file")).toContainText(name);
  await dialog.getByLabel("회의일").fill("2026-11-03");
  if (title) await dialog.getByLabel(/제목/).fill(title);
  await dialog.getByRole("button", { name: "올리기" }).click();
  await expect(page).toHaveURL(/\/minutes\?id=/);
  return dialog;
}

test.describe("회의록 업로드·추출 (T1)", () => {
  test.beforeEach(async ({ page }) => {
    await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  });

  for (const name of ["minutes-2up.pdf", "minutes.docx", "minutes.hwpx", "minutes.txt"]) {
    test(`${name}: 업로드 → 추출 완료 → 원문 표시 → 새로고침 후에도 유지`, async ({ page }) => {
      await uploadFile(page, name, `E2E ${name}`);
      await expect(page.getByTestId("meeting-status")).toHaveText(DONE, { timeout: 30_000 });
      await page.getByRole("tab", { name: "원문" }).click();
      const original = page.getByTestId("original-text");
      await expect(original).toContainText("12월 10일 종강 간식 행사 진행, 학생회비 사용");
      await expect(original).toContainText("간식 행사 카드뉴스 제작");
      await page.reload();
      await expect(page.getByTestId("original-text")).toContainText("12월 10일 종강 간식 행사 진행");
      await expect(page.getByRole("list", { name: "회의록 목록" })).toContainText(`E2E ${name}`);
    });
  }

  test("스캔 PDF: 실패 + 안내 문구 + 다시 올리기", async ({ page }) => {
    await uploadFile(page, "scanned.pdf", "E2E 스캔본");
    await expect(page.getByTestId("meeting-status")).toHaveText("실패", { timeout: 20_000 });
    await expect(page.getByTestId("extraction-error")).toContainText("텍스트 레이어");
    await expect(page.getByRole("button", { name: "파일 다시 올리기" })).toBeVisible();
  });

  test("지원하지 않는 형식은 업로드 단계에서 거부", async ({ page }) => {
    await page.getByRole("button", { name: "회의록 업로드" }).click();
    const dialog = page.getByRole("dialog", { name: "회의록 올리기" });
    await dialog.getByLabel("회의록 파일").setInputFiles(FX("program.exe"));
    await dialog.getByRole("button", { name: "올리기" }).click();
    await expect(formAlert(page)).toContainText("지원하지 않는 파일 형식");
    await expect(dialog).toBeVisible();
  });

  test("텍스트 붙여넣기 → 추출 완료", async ({ page }) => {
    await page.getByRole("button", { name: "회의록 업로드" }).click();
    const dialog = page.getByRole("dialog", { name: "회의록 올리기" });
    await dialog.getByRole("tab", { name: "텍스트 붙여넣기" }).click();
    await dialog.getByLabel("회의록 내용").fill("E2E 붙여넣기 임시회의\n- 12월 첫째주까지 종이 보수 예정");
    await dialog.getByLabel("회의 유형").selectOption("extraordinary");
    await dialog.getByRole("button", { name: "올리기" }).click();
    await expect(page.getByTestId("meeting-status")).toHaveText(DONE, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 2, name: "E2E 붙여넣기 임시회의" })).toBeVisible();
    await page.getByRole("tab", { name: "원문" }).click();
    await expect(page.getByTestId("original-text")).toContainText("12월 첫째주까지 종이 보수 예정");
  });

  test("원본 내려받기: 서명 URL 로 받을 수 있고, 위조·만료 링크는 거부 (T12 일부)", async ({ page }) => {
    await uploadFile(page, "minutes.txt", "E2E 다운로드");
    await expect(page.getByTestId("meeting-status")).toHaveText(DONE, { timeout: 30_000 });
    await page.getByRole("tab", { name: "파일" }).click();
    const href = await page.getByTestId("download-original").getAttribute("href");
    expect(href).toMatch(/^\/api\/files\?key=/);
    const ok = await page.request.get(href!);
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-disposition"]).toContain("attachment");
    expect(await ok.text()).toContain("제9대 데모단과대학 학생회 제5차 회의록");

    const forged = new URL(href!, "http://x");
    forged.searchParams.set("sig", "AAAA");
    expect((await page.request.get(`${forged.pathname}${forged.search}`)).status()).toBe(403);
    const expired = new URL(href!, "http://x");
    expired.searchParams.set("exp", String(Math.floor(Date.now() / 1000) - 1));
    expect((await page.request.get(`${expired.pathname}${expired.search}`)).status()).toBe(403); // 서명 불일치로도 거부

    // 로그인하지 않은 사용자는 유효한 링크도 받을 수 없음
    const anon = await page.context().browser()!.newContext();
    expect((await anon.request.get(`http://localhost:${process.env.E2E_PORT ?? 3200}${href}`)).status()).toBe(401);
    await anon.close();
  });

  test("대시보드 최근 회의록 → 드로어 미리보기 → 회의록 공간", async ({ page }) => {
    await uploadFile(page, "minutes.hwpx", "E2E 드로어 확인");
    await expect(page.getByTestId("meeting-status")).toHaveText(DONE, { timeout: 30_000 });
    await page.goto("/");
    await page.getByRole("link", { name: /E2E 드로어 확인/ }).first().click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toContainText(DONE);
    await expect(drawer).toContainText("12월 10일 종강 간식 행사 진행");
    await drawer.getByRole("link", { name: /회의록 공간에서 전체 보기/ }).click();
    await expect(page).toHaveURL(/\/minutes\?id=/);
    await expect(page.getByRole("heading", { level: 2, name: "E2E 드로어 확인" })).toBeVisible();
  });
});

test("국원: 업로드 버튼 없음 + API 403, 회의록 열람은 가능 (Q4)", async ({ page }) => {
  await loginOk(page, E2E.memberEmail, E2E.demoPassword);
  await expect(page.getByRole("button", { name: "회의록 업로드" })).toHaveCount(0);
  const res = await page.request.post("/api/meetings", { multipart: { meetingDate: "2026-11-03", meetingType: "regular", text: "무단 업로드" } });
  expect(res.status()).toBe(403);
  await page.goto("/minutes");
  await expect(page.getByRole("heading", { level: 1, name: "회의록" })).toBeVisible();
  await expect(page.getByRole("button", { name: "회의록 올리기" })).toHaveCount(0);
});
