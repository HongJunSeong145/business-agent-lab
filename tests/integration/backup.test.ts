import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetAllTables } from "@/lib/setup/reset";
import { ensureBaseSetup } from "@/lib/setup/bootstrap";
import { seedDemo, seedDemoContent } from "@/lib/setup/demo";
import { exportBackup, restoreBackup } from "@/lib/backup";

/** Phase 10: 백업 리허설 — 내보내기 → 데이터 변경 → 복원하면 원래대로(파일 바이트 포함) */
beforeAll(() => {
  if (!/kgb_test/.test(process.env.DATABASE_URL ?? "")) throw new Error("kgb_test 전용");
});
afterAll(async () => prisma.$disconnect());

describe("백업·복원", () => {
  it("데모 데이터 + 파일을 내보내고, 지운 뒤 복원하면 행 수·내용·바이트가 같다 / 잘못된 파일은 거부", async () => {
    await resetAllTables(prisma);
    await ensureBaseSetup(prisma, new Date("2026-10-31T00:00:00Z"));
    await seedDemo(prisma, "demo-pass-123");
    const c = await seedDemoContent(prisma, "2026-10-31");
    expect(c.created).toBe(true);
    expect((await seedDemoContent(prisma, "2026-10-31")).created).toBe(false); // 두 번째는 건너뜀
    await prisma.storedFile.create({ data: { storage_key: "evidence/2026/10/01a19234-0000-7000-8000-000000000009", data: Buffer.from([0, 1, 2, 255]), size: 4n } });
    const backup = await exportBackup(prisma);
    const before = { tasks: await prisma.task.count(), projects: await prisma.project.count(), meetings: await prisma.meeting.count() };
    expect(before).toEqual({ tasks: expect.any(Number), projects: 2, meetings: 2 });

    await prisma.task.deleteMany({});
    await prisma.storedFile.deleteMany({});
    const counts = await restoreBackup(prisma, JSON.parse(JSON.stringify(backup)));
    expect(counts.tasks).toBe(before.tasks);
    expect({ tasks: await prisma.task.count(), projects: await prisma.project.count(), meetings: await prisma.meeting.count() }).toEqual(before);
    expect([...(await prisma.storedFile.findFirstOrThrow()).data]).toEqual([0, 1, 2, 255]);
    await expect(restoreBackup(prisma, { format: "nope" } as never)).rejects.toThrow(/백업 파일이 아닙니다/);
    await expect(restoreBackup(prisma, { ...backup, tables: { hacked: [] } })).rejects.toThrow(/없는 표/);
  });
});
