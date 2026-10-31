import { expect, test } from "@playwright/test";
import { E2E } from "./fixtures";
import { loginOk } from "./helpers";

/** Phase 10 보안 점검: 보안 헤더, 업로드 상한, 백업 권한, 로그인 없는 API 거부 */
test("보안 헤더: 페이지는 iframe 금지(DENY·frame-ancestors none), 파일 응답은 같은 사이트 미리보기만(SAMEORIGIN)", async ({ page }) => {
  const res = await page.request.get("/login");
  const h = res.headers();
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-powered-by"]).toBeUndefined();
  expect(h["strict-transport-security"]).toContain("max-age=");
  const f = await page.request.get("/api/files?key=x");
  expect(f.headers()["x-frame-options"]).toBe("SAMEORIGIN");
});

test("로그인 없이 API 는 401, 국원은 백업 403 / 관리자는 백업 JSON", async ({ page, browser }) => {
  const anon = await browser.newContext();
  for (const url of ["/api/tasks", "/api/search?q=a", "/api/backup", "/api/finance/4", "/api/notifications"]) {
    expect((await anon.request.get(`http://localhost:${process.env.E2E_PORT ?? 3200}${url}`)).status(), url).toBe(401);
  }
  await anon.close();
  await loginOk(page, "promotion.member@demo.kgb.invalid", E2E.demoPassword);
  expect((await page.request.get("/api/backup")).status()).toBe(403);
  await page.context().clearCookies();
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  await page.goto("/settings");
  await expect(page.getByTestId("backup-download")).toBeVisible();
  const b = await page.request.get("/api/backup");
  expect(b.status()).toBe(200);
  const json = (await b.json()) as { format: string; tables: Record<string, unknown[]> };
  expect(json.format).toBe("kgb-backup");
  expect(json.tables.users!.length).toBeGreaterThan(0);
});

test("업로드 상한(50MB) 초과는 413 — 서버가 본문을 받기 전에 거부", async ({ page }) => {
  await loginOk(page, E2E.adminEmail, E2E.adminPassword);
  const big = Buffer.alloc(52 * 1024 * 1024, 0x61);
  const r = await page.request.post("/api/meetings", { multipart: { meetingDate: "2026-11-01", meetingType: "regular", file: { name: "big.txt", mimeType: "text/plain", buffer: big } } });
  expect(r.status()).toBe(413);
  expect(((await r.json()) as { error: string }).error).toMatch(/최대 50MB/);
});
