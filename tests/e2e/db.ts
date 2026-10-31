import pg from "pg";
import { E2E } from "./fixtures";

/** E2E 검증용 직접 DB 조회·주입 (테스트 DB 전용) */
export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: E2E.databaseUrl });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}
