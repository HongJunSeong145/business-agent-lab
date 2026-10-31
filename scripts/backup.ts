/**
 * 백업·복원 (docs/OPERATIONS.md)
 *   pnpm backup:export [파일]              — 현재 DATABASE_URL 전체를 JSON 으로
 *   pnpm backup:restore <파일> -- --yes    — 대상 DB 를 비우고 백업으로 되돌림(마이그레이션 먼저 적용)
 * 운영(production) 복원은 --i-know-this-is-production 까지 붙여야 실행된다.
 */
import { config } from "dotenv";
config({ path: ".env.local", override: false, quiet: true });
import { readFileSync, writeFileSync } from "node:fs";

const [cmd, file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const { prisma } = await import("../lib/db");
const { exportBackup, restoreBackup } = await import("../lib/backup");
try {
  if (cmd === "export") {
    const data = await exportBackup(prisma);
    const out = file ?? `kgb-backup-${data.createdAt.slice(0, 10)}.json`;
    writeFileSync(out, JSON.stringify(data));
    const rows = Object.values(data.tables).reduce((n, t) => n + t.length, 0);
    console.log(`백업 완료: ${out} (표 ${Object.keys(data.tables).length}개, 행 ${rows}개, 마이그레이션 ${data.migration})`);
  } else if (cmd === "restore") {
    if (!file) throw new Error("복원할 백업 파일을 지정하세요.");
    if (!process.argv.includes("--yes")) throw new Error("대상 DB 의 모든 데이터를 백업 내용으로 바꿉니다. 계속하려면 --yes 를 붙이세요.");
    if (process.env.APP_ENV === "production" && !process.argv.includes("--i-know-this-is-production")) throw new Error("운영 DB 복원은 --i-know-this-is-production 이 필요합니다.");
    const counts = await restoreBackup(prisma, JSON.parse(readFileSync(file, "utf8")));
    console.log(`복원 완료: 행 ${Object.values(counts).reduce((a, b) => a + b, 0)}개`);
  } else {
    console.log("사용법: pnpm backup:export [파일] | pnpm backup:restore <파일> -- --yes");
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
