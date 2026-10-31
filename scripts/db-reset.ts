/**
 * 개발·테스트·스테이징 DB 초기화 후 재시드. 운영(production)에서는 실행 거부 (지시서 13).
 *   pnpm db:reset -- --yes
 */
import { config } from "dotenv";
config({ path: ".env.local", override: false, quiet: true });
config({ path: ".env", override: false, quiet: true });

if (process.env.APP_ENV === "production") {
  console.error("운영 환경에서는 DB 초기화를 실행할 수 없습니다.");
  process.exit(1);
}
if (!process.argv.includes("--yes")) {
  console.error(`DB(${process.env.APP_ENV ?? "development"})의 모든 데이터를 삭제합니다. 계속하려면 --yes 를 붙이세요.`);
  process.exit(1);
}

const { prisma } = await import("../lib/db");
const { resetAllTables } = await import("../lib/setup/reset");
try {
  await resetAllTables(prisma);
  console.log("모든 테이블을 비웠습니다. 이어서 pnpm db:seed 를 실행하세요.");
} finally {
  await prisma.$disconnect();
}
