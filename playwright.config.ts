import { defineConfig, devices } from "@playwright/test";

/**
 * E2E: 테스트 전용 DB(TEST_DATABASE_URL)에 마이그레이션·시드 후 프로덕션 빌드를 띄워 실제 브라우저로 조작한다.
 * 사전 조건: pnpm build
 */
const PORT = Number(process.env.E2E_PORT ?? 3200);
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://kgb:kgb_dev_pw@localhost:5432/kgb_test";

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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      APP_ENV: "test",
      DATABASE_URL,
      AUTH_SECRET: "e2e-only-secret-0123456789abcdef-0123456789",
      AUTH_URL: `http://localhost:${PORT}`,
      AI_PROVIDER: "mock",
      STORAGE_DRIVER: "db",
      WORKER_MODE: "inline",
      UPLOAD_MAX_MB: "50",
    },
  },
});
