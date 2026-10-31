/**
 * 시드 (재실행 가능): 기본 구조 + 초기 관리자 + (SEED_DEMO=true 면) 데모 데이터.
 *   pnpm db:seed
 */
import { config } from "dotenv";
config({ path: ".env.local", override: false, quiet: true });
config({ path: ".env", override: false, quiet: true });

const { prisma } = await import("../lib/db");
const { ensureBaseSetup, ensureInitialAdmin } = await import("../lib/setup/bootstrap");
const { seedDemo } = await import("../lib/setup/demo");

try {
  const term = await ensureBaseSetup(prisma);
  console.log(`기본 구조 확인: 기수 ${term.term_number}대`);
  const admin = await ensureInitialAdmin(prisma, process.env.INITIAL_ADMIN_EMAIL, process.env.INITIAL_ADMIN_PASSWORD);
  console.log(admin.created ? "초기 관리자 생성" : `초기 관리자: ${admin.reason}`);
  if (process.env.SEED_DEMO === "true") {
    const r = await seedDemo(prisma, process.env.SEED_DEMO_PASSWORD);
    console.log(`데모 데이터: 회원 ${r.users}명, 연락처 ${r.contacts}건 (데모 계정 로그인 ${r.loginEnabled ? "가능" : "불가 — SEED_DEMO_PASSWORD 미설정"})`);
  }
} finally {
  await prisma.$disconnect();
}
