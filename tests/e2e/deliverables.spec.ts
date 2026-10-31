import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./fixtures";
import { loginOk } from "./helpers";
import { sql } from "./db";

/**
 * Phase 6: 작업물 업로드·버전·미리보기·서명 URL·AI 평가(mock) — T12, T13, T14
 */
test.describe.configure({ mode: "serial" });

const TASK = "E2E 포스터 제작";
const PROMO_MEMBER = "promotion.member@demo.kgb.invalid"; // 장홍보
const SEC_MEMBER = "secretariat.member@demo.kgb.invalid"; // 조사무(다른 국서)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const taskId = async () => (await sql<{ id: string }>("SELECT id FROM tasks WHERE title = $1 AND deleted_at IS NULL", [TASK]))[0]!.id;
const row = (page: Page) => page.locator("li[data-task-id]").filter({ has: page.getByRole("link", { name: TASK, exact: true }) });

async function openDeliverables(page: Page) {
  await page.goto("/departments/promotion");
  await row(page).getByTestId("row-upload").click();
  await expect(page.getByTestId("deliverables-tab")).toBeVisible();
  return page.getByTestId("deliverables-tab");
}

test("준비: 홍보국 업무(담당 장홍보, 완료 기준 3개)", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  const [dept] = await sql<{ id: string }>("SELECT d.id FROM departments d WHERE d.code = 'promotion' LIMIT 1");
  const [member] = await sql<{ id: string }>("SELECT id FROM users WHERE email = $1", [PROMO_MEMBER]);
  const res = await page.request.post("/api/tasks", {
    data: { title: TASK, lead_department_id: dept!.id, assignee_ids: [member!.id], acceptance_criteria: ["행사명", "일시", "장소"].map((text) => ({ text, done: false })) },
  });
  expect(res.status()).toBe(201);
});

test("T12·T13: 국원이 이미지 업로드 → 미리보기·AI 평가 → 2차 버전(텍스트) → 평가 갱신·진척도 반영", async ({ page }) => {
  await loginOk(page, PROMO_MEMBER, E2E.demoPassword);
  const tab = await openDeliverables(page);
  await expect(tab).toContainText("아직 올린 작업물이 없습니다");

  // 1차: 이미지
  const form = tab.getByRole("form", { name: "작업물 업로드" });
  await form.getByLabel("작업물 파일").setInputFiles({ name: "포스터-시안.png", mimeType: "image/png", buffer: PNG });
  await form.getByLabel("작업물 이름(선택)").fill("포스터");
  await form.getByLabel("메모(선택)").fill("1차 시안");
  await form.getByRole("button", { name: "올리기" }).click();
  await expect(page.getByText(/v1 업로드 완료/)).toBeVisible();
  const card = tab.getByTestId("deliverable");
  await expect(card.getByLabel("작업물 이름: 포스터")).toHaveValue("포스터");
  await expect(card.getByRole("img", { name: /미리보기/ })).toBeVisible();
  await expect(card.getByTestId("eval-score")).toBeVisible({ timeout: 30_000 });
  await expect(card.getByTestId("evaluation")).toContainText("부분"); // mock 은 이미지를 '부분'으로 판정

  // 2차: 같은 작업물에 새 버전(텍스트)
  await expect(form.getByLabel("올릴 곳")).toHaveValue(/.+/); // 기본: 가장 최근 작업물의 새 버전
  await form.getByLabel("작업물 파일").setInputFiles({ name: "포스터-문구.txt", mimeType: "text/plain", buffer: Buffer.from("행사명: 종강 파티\n일시: 12월 9일\n장소: 데모관 로비") });
  await form.getByLabel("메모(선택)").fill("2차 — 장소 추가");
  await form.getByRole("button", { name: "올리기" }).click();
  await expect(page.getByText(/v2 업로드 완료/)).toBeVisible();
  await expect(card.getByRole("list", { name: "버전 목록" }).getByRole("listitem")).toHaveCount(2);
  await expect(card.getByTestId("eval-score")).toHaveText("100%", { timeout: 30_000 });
  await expect(card.getByLabel("추출 텍스트 미리보기")).toContainText("데모관 로비");

  // 개요 탭 진척도 = AI 값
  await page.getByRole("tab", { name: "개요" }).click();
  await expect(page.getByTestId("task-drawer")).toContainText("AI 100%");
  const [t] = await sql<{ ai_progress: number }>("SELECT ai_progress FROM tasks WHERE title = $1", [TASK]);
  expect(t!.ai_progress).toBe(100);
  expect(Number((await sql<{ n: string }>("SELECT count(*) n FROM progress_evaluations"))[0]!.n)).toBe(2);
});

test("T12: 다른 국서 구성원도 열람(업로드 영역 없음), 서명 URL 은 위조·만료 시 거부, 로그아웃 상태 거부", async ({ page, browser }) => {
  await loginOk(page, SEC_MEMBER, E2E.demoPassword);
  await page.goto(`/departments/promotion?task=${await taskId()}&tab=deliverables`);
  const tab = page.getByTestId("deliverables-tab");
  await expect(tab.getByTestId("deliverable")).toBeVisible();
  await expect(tab.getByRole("form", { name: "작업물 업로드" })).toHaveCount(0);
  await tab.getByRole("button", { name: /v1/ }).click();
  const src = (await tab.getByRole("img", { name: /미리보기/ }).getAttribute("src"))!;
  const ok = await page.request.get(src);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-type"]).toBe("image/png");
  expect(ok.headers()["x-content-type-options"]).toBe("nosniff");
  const u = new URL(src, "http://x");
  u.searchParams.set("exp", String(Number(u.searchParams.get("exp")) + 60)); // 만료 시각 위조
  expect((await page.request.get(`${u.pathname}${u.search}`)).status()).toBe(403);
  u.searchParams.set("exp", String(Math.floor(Date.now() / 1000) - 1)); // 이미 지난 시각(서명 불일치 → 거부)
  expect((await page.request.get(`${u.pathname}${u.search}`)).status()).toBe(403);
  const anon = await browser.newContext();
  expect((await anon.request.get(new URL(src, page.url()).toString())).status()).toBe(401);
  await anon.close();
});

test("T14: 수동 40% 후 재평가 → 표시는 수동 40% 유지 / 업무 행 📎에 파일을 끌어다 놓으면 새 버전", async ({ page }) => {
  await loginOk(page, PROMO_MEMBER, E2E.demoPassword);
  await page.goto(`/departments/promotion?task=${await taskId()}`);
  const drawer = page.getByTestId("task-drawer");
  await drawer.getByLabel("수동 진척도(%)").fill("40");
  await drawer.getByRole("button", { name: "진척도 저장" }).click();
  await expect(drawer).toContainText("수동 40%");
  await page.getByRole("tab", { name: "작업물" }).click();
  await page.getByTestId("evaluation").getByRole("button", { name: "다시 평가" }).click();
  await expect(page.getByText("다시 평가를 시작했습니다.")).toBeVisible();
  await expect.poll(async () => Number((await sql<{ n: string }>("SELECT count(*) n FROM progress_evaluations"))[0]!.n), { timeout: 30_000 }).toBe(3);
  const [t] = await sql<{ ai_progress: number; manual_progress: number }>("SELECT ai_progress, manual_progress FROM tasks WHERE title = $1", [TASK]);
  expect(t).toEqual({ ai_progress: 100, manual_progress: 40 });

  // 드래그 앤 드롭 업로드
  await page.keyboard.press("Escape");
  const target = row(page).getByTestId("row-upload");
  await expect(target).toContainText("1");
  const dt = await page.evaluateHandle((b64) => {
    const d = new DataTransfer();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    d.items.add(new File([bytes], "드롭.png", { type: "image/png" }));
    return d;
  }, PNG.toString("base64"));
  await target.dispatchEvent("dragover", { dataTransfer: dt });
  await target.dispatchEvent("drop", { dataTransfer: dt });
  await expect(page.getByText(/작업물 v3 업로드 완료/)).toBeVisible();
  await expect(row(page).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
});

test("업로드 거부: 위장 파일은 안내 문구", async ({ page }) => {
  await loginOk(page, PROMO_MEMBER, E2E.demoPassword);
  const tab = await openDeliverables(page);
  const form = tab.getByRole("form", { name: "작업물 업로드" });
  await form.getByLabel("작업물 파일").setInputFiles(path.resolve("tests/fixtures/minutes/not-a-pdf.pdf"));
  await form.getByRole("button", { name: "올리기" }).click();
  await expect(page.getByText(/형식이 아닙니다/)).toBeVisible();
});
