import type { Db } from "@/lib/db";

/** _prisma_migrations 를 제외한 public 스키마 전체 테이블 TRUNCATE (운영 금지 — 호출 측에서 확인) */
export async function resetAllTables(db: Db): Promise<void> {
  if (process.env.APP_ENV === "production") throw new Error("운영 환경에서는 초기화할 수 없습니다.");
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename.replace(/"/g, '""')}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
