// E2E 전용 DB 준비 — .env.local 을 읽지 않는다(테스트 DB 보호)
import { execSync } from "node:child_process";

const url = process.env.DATABASE_URL ?? "";
if (!/kgb_test/.test(url)) throw new Error(`E2E 는 테스트 DB(kgb_test)에서만 실행합니다: ${url.replace(/\/\/.*@/, "//***@")}`);

execSync("pnpm exec prisma migrate deploy", { stdio: "inherit", env: process.env });
const { prisma } = await import("../../lib/db");
const { resetAllTables } = await import("../../lib/setup/reset");
const { ensureBaseSetup, ensureInitialAdmin } = await import("../../lib/setup/bootstrap");
const { seedDemo } = await import("../../lib/setup/demo");
try {
  await resetAllTables(prisma);
  await ensureBaseSetup(prisma, new Date("2026-10-31T00:00:00Z")); // 기수 날짜 고정
  await ensureInitialAdmin(prisma, process.env.INITIAL_ADMIN_EMAIL, process.env.INITIAL_ADMIN_PASSWORD);
  await seedDemo(prisma, process.env.SEED_DEMO_PASSWORD);
} finally {
  await prisma.$disconnect();
}
