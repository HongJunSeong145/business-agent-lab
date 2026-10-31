import { expect, test } from "@playwright/test";
import { E2E } from "./fixtures";
import { loginOk } from "./helpers";

/** T25: AI 키가 없는 서버(AI_PROVIDER=none, 별도 DB) — 수동 기능 정상 + "AI 일시 사용 불가" 표시 */
test("T25: AI 없이도 회의록 업로드·열람과 업무 직접 만들기가 정상", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await expect(page.getByTestId("ai-off")).toHaveText("AI 일시 사용 불가");

  await page.getByRole("button", { name: "회의록 업로드" }).click();
  const d = page.getByRole("dialog", { name: "회의록 올리기" });
  await d.getByRole("tab", { name: "텍스트 붙여넣기" }).click();
  await d.getByLabel("회의록 내용").fill("AI 없는 회의\n1. 안건\n-> 기획국이 기획안 작성");
  await d.getByRole("button", { name: "올리기" }).click();
  await expect(page.getByTestId("meeting-status")).toHaveText("추출 완료", { timeout: 20_000 });
  await expect(page.getByTestId("ai-unavailable")).toContainText("AI 일시 사용 불가");
  await expect(page.getByRole("button", { name: /AI 분석|재분석/ })).toHaveCount(0);
  await page.waitForTimeout(3000);
  await page.reload();
  await expect(page.getByTestId("meeting-status")).toHaveText("추출 완료"); // 분석으로 넘어가지 않음
  expect((await page.request.post(`${page.url().split("/minutes")[0]}/api/meetings/${new URL(page.url()).searchParams.get("id")}/analyze`)).status()).toBe(503);

  await page.goto("/departments/planning");
  await page.getByRole("button", { name: "업무 추가" }).click();
  const td = page.getByRole("dialog", { name: "업무 추가" });
  await td.getByLabel("업무명").fill("AI 없이 만든 업무");
  await td.getByRole("button", { name: "업무 추가" }).click();
  await expect(td).toBeHidden();
  await expect(page.getByRole("link", { name: "AI 없이 만든 업무", exact: true })).toBeVisible();

  // 작업물: 올릴 수 있고, AI 평가 대신 수동 진척도 안내
  await page.getByRole("link", { name: "AI 없이 만든 업무", exact: true }).click();
  await page.getByRole("tab", { name: "작업물" }).click();
  const tab = page.getByTestId("deliverables-tab");
  await expect(tab).toContainText("AI 일시 사용 불가");
  await tab.getByLabel("작업물 파일").setInputFiles({ name: "초안.txt", mimeType: "text/plain", buffer: Buffer.from("기획안 초안") });
  await tab.getByRole("button", { name: "올리기" }).click();
  await expect(page.getByText("v1 업로드 완료.", { exact: true })).toBeVisible();
  await expect(tab.getByTestId("eval-status")).toContainText("AI 일시 사용 불가");

  // 레퍼런스: 의뢰 버튼 대신 안내, 직접 추가는 가능
  await page.getByRole("tab", { name: "레퍼런스" }).click();
  const refs = page.getByTestId("references-tab");
  await expect(refs.getByTestId("reference-ai-off")).toBeVisible();
  await refs.getByLabel("레퍼런스 링크").fill("https://www.example.com/a");
  await refs.getByRole("button", { name: "추가", exact: true }).click();
  await expect(refs.getByRole("link", { name: "https://www.example.com/a" })).toBeVisible();
});
