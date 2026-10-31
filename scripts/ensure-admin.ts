/** 배포 시작 시 실행: 기본 구조 + 초기 관리자 보장 (멱등) */
import { config } from "dotenv";
config({ path: ".env.local", override: false, quiet: true });
config({ path: ".env", override: false, quiet: true });

const { prisma } = await import("../lib/db");
const { ensureBaseSetup, ensureInitialAdmin } = await import("../lib/setup/bootstrap");

try {
  await ensureBaseSetup(prisma);
  const r = await ensureInitialAdmin(prisma, process.env.INITIAL_ADMIN_EMAIL, process.env.INITIAL_ADMIN_PASSWORD);
  console.log(r.created ? "초기 관리자 계정을 만들었습니다." : `초기 관리자: ${r.reason}`);
} finally {
  await prisma.$disconnect();
}
