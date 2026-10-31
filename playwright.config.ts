import { defineConfig, devices } from "@playwright/test";

/**
 * E2E: 테스트 전용 DB(TEST_DATABASE_URL)에 마이그레이션·시드 후 프로덕션 빌드를 띄워 실제 브라우저로 조작한다.
 * 사전 조건: pnpm build
 */
const PORT = Number(process.env.E2E_PORT ?? 3200);
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://kgb:kgb_dev_pw@localhost:5432/kgb_test";
// T25(AI 없음) 서버는 큐·DB 를 분리해 mock 서버 워커가 끼어들지 않게 한다
const NOAI_DATABASE_URL = DATABASE_URL.replace(/kgb_test(?=$|\?)/, "kgb_test_noai");

function server(port: number, ai: "mock" | "none") {
  return {
    command: `pnpm exec next start -p ${port}`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      APP_ENV: "test",
      DATABASE_URL: ai === "mock" ? DATABASE_URL : NOAI_DATABASE_URL,
      AUTH_SECRET: "e2e-only-secret-0123456789abcdef-0123456789",
      AUTH_URL: `http://localhost:${port}`,
      AI_PROVIDER: ai,
      OPENROUTER_API_KEY: "",
      STORAGE_DRIVER: "db",
      WORKER_MODE: "inline",
      UPLOAD_MAX_MB: "50",
      // 날짜에 따라 결과가 달라지는 T5·T6 를 언제 실행해도 같게 (APP_ENV=test 에서만 적용)
      KGB_FAKE_TODAY: "2026-10-31",
    },
  };
}

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: /no-ai\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // T25: AI 키 없음(AI_PROVIDER=none) 서버
    { name: "no-ai", testMatch: /no-ai\.spec\.ts/, dependencies: ["chromium"], use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: `http://localhost:${PORT + 1}` } },
  ],
  webServer: [server(PORT, "mock"), server(PORT + 1, "none")],
});
