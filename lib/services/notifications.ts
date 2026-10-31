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

/** 알림 벨 (8-1): 최근 30건 + 읽지 않은 수 */
export async function listNotifications(db: Pick<Tx, "notification">, userId: string) {
  const [items, unread] = await Promise.all([
    db.notification.findMany({ where: { user_id: userId }, orderBy: { created_at: "desc" }, take: 30 }),
    db.notification.count({ where: { user_id: userId, read_at: null } }),
  ]);
  return { unread, items: items.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, severity: n.severity, read: !!n.read_at, at: n.created_at })) };
}

/** 읽음 처리: ids 가 없으면 전부 */
export async function markNotificationsRead(db: Pick<Tx, "notification">, userId: string, ids?: string[]) {
  const r = await db.notification.updateMany({ where: { user_id: userId, read_at: null, ...(ids?.length ? { id: { in: ids } } : {}) }, data: { read_at: new Date() } });
  return r.count;
}
