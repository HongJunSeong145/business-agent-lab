import { expect, type Page } from "@playwright/test";

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
}

/** 로그인 성공까지 기다린다(서버 액션 완료 전에 이동하면 로그인이 취소됨) */
export async function loginOk(page: Page, email: string, password: string) {
  await login(page, email, password);
  await expect(page).toHaveURL(/\/$/);
}

/** Next.js 라우트 안내 영역(role=alert)과 구분하기 위해 폼 메시지만 선택 */
export const formAlert = (page: Page) => page.locator("p[role='alert']");
