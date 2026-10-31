import type { Db } from "@/lib/db";

/**
 * 전체 백업·복원 (OPERATIONS.md): public 스키마의 모든 표를 JSON 으로 내보내고 그대로 되돌린다.
 *  - STORAGE_DRIVER=db 면 업로드 파일(바이트)도 표 안에 있어 함께 백업된다.
 *  - 마이그레이션 기록(_prisma_migrations)·작업 큐(pgboss)는 제외 — 복원 대상 DB 는 먼저 마이그레이션을 적용한다.
 *  - 복원: 한 트랜잭션에서 전부 비우고 외래키 순서대로 넣는다(실패하면 아무것도 바뀌지 않음).
 */
export type BackupFile = { format: "kgb-backup"; version: 1; createdAt: string; migration: string | null; tables: Record<string, unknown[]> };

const SKIP = new Set(["_prisma_migrations"]);

async function tableNames(db: Db): Promise<string[]> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  return rows.map((r) => r.tablename).filter((t) => !SKIP.has(t));
}

/** 외래키 순서(부모 먼저) */
async function insertOrder(db: Db, tables: string[]): Promise<string[]> {
  const fks = await db.$queryRaw<{ child: string; parent: string }[]>`
    SELECT c.relname AS child, p.relname AS parent FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid JOIN pg_class p ON p.oid = k.confrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE k.contype = 'f' AND n.nspname = 'public'`;
  const order: string[] = [];
  const left = new Set(tables);
  while (left.size) {
    const ready = [...left].filter((t) => !fks.some((f) => f.child === t && f.parent !== t && left.has(f.parent)));
    if (!ready.length) throw new Error(`외래키 순환: ${[...left].join(", ")}`);
    for (const t of ready.sort()) {
      order.push(t);
      left.delete(t);
    }
  }
  return order;
}

const ident = (t: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(t)) throw new Error(`잘못된 표 이름: ${t}`);
  return `"${t}"`;
};

export async function exportBackup(db: Db): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const t of await tableNames(db)) {
    const [r] = await db.$queryRawUnsafe<{ rows: unknown[] }[]>(`SELECT coalesce(json_agg(x), '[]'::json) AS rows FROM ${ident(t)} x`);
    tables[t] = r?.rows ?? [];
  }
  const [m] = await db.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1`;
  return { format: "kgb-backup", version: 1, createdAt: new Date().toISOString(), migration: m?.migration_name ?? null, tables };
}

export async function restoreBackup(db: Db, file: BackupFile): Promise<Record<string, number>> {
  if (file?.format !== "kgb-backup" || file.version !== 1) throw new Error("KGB 백업 파일이 아닙니다.");
  const current = await tableNames(db);
  const unknown = Object.keys(file.tables).filter((t) => !current.includes(t));
  if (unknown.length) throw new Error(`이 DB 에 없는 표가 있습니다(마이그레이션 버전 확인): ${unknown.join(", ")}`);
  const order = await insertOrder(db, current);
  const counts: Record<string, number> = {};
  await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`TRUNCATE ${current.map(ident).join(", ")} CASCADE`);
      for (const t of order) {
        const rows = file.tables[t] ?? [];
        counts[t] = rows.length;
        if (!rows.length) continue;
        // 큰 표는 나눠 넣는다
        for (let i = 0; i < rows.length; i += 500) {
          await tx.$executeRawUnsafe(`INSERT INTO ${ident(t)} SELECT * FROM json_populate_recordset(null::${ident(t)}, $1::json)`, JSON.stringify(rows.slice(i, i + 500)));
        }
      }
    },
    { timeout: 300_000, maxWait: 30_000 },
  );
  return counts;
}
