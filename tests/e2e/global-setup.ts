import { execSync } from "node:child_process";
import { E2E } from "./fixtures";

/** 테스트 DB 초기화: 마이그레이션 → 전체 비우기 → 시드(관리자 + 데모) */
export default function globalSetup() {
  const env = {
    ...process.env,
    APP_ENV: "test",
    DATABASE_URL: E2E.databaseUrl,
    INITIAL_ADMIN_EMAIL: E2E.adminEmail,
    INITIAL_ADMIN_PASSWORD: E2E.adminPassword,
    SEED_DEMO: "true",
    SEED_DEMO_PASSWORD: E2E.demoPassword,
    DOTENV_CONFIG_QUIET: "true",
  };
  const run = (cmd: string, extra: Record<string, string> = {}) => execSync(cmd, { stdio: "inherit", env: { ...env, ...extra } });
  run("pnpm exec tsx tests/e2e/prepare-db.ts");
  run("pnpm exec tsx tests/e2e/prepare-db.ts", { DATABASE_URL: E2E.noAiDatabaseUrl });
}
