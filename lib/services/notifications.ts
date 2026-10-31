import type { Prisma } from "@/lib/generated/prisma/client";

type Tx = Prisma.TransactionClient;

/** 회장·국장·관리자에게 알림 (같은 dedupe_key 는 사용자당 한 번) */
export async function notifyLeaders(
  tx: Tx,
  termId: string,
  n: { type: string; title: string; body?: string; link?: string; severity?: "info" | "warn" | "critical"; dedupeKey?: string },
) {
  const leaders = await tx.membership.findMany({ where: { term_id: termId, role: { in: ["admin", "president", "head"] }, user: { status: "active" } }, select: { user_id: true } });
  if (leaders.length === 0) return 0;
  const r = await tx.notification.createMany({
    data: leaders.map((l) => ({
      user_id: l.user_id, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null, severity: n.severity ?? "info", dedupe_key: n.dedupeKey ?? null,
    })),
    skipDuplicates: true,
  });
  return r.count;
}
