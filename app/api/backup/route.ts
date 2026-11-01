import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { assertCan } from "@/lib/auth/can";
import { writeAudit } from "@/lib/audit/log";
import { exportBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 전체 백업 내려받기 — 관리자 전용(ADR-016: 백업은 admin 만) */
export async function GET() {
  return withUser(async (u) => {
    assertCan(u, { type: "backup.manage" });
    const data = await exportBackup(prisma);
    await writeAudit(prisma, { actorId: u.userId, action: "backup.export", entityType: "system", entityId: u.termId, diff: { tables: Object.keys(data.tables).length } });
    const name = `kgb-backup-${data.createdAt.slice(0, 19).replace(/[:T]/g, "-")}.json`;
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
    });
  });
}
