import type { Prisma } from "@/lib/generated/prisma/client";
import { maskDeep } from "./mask";

type TxLike = { activityLog: { create: (args: { data: Prisma.ActivityLogUncheckedCreateInput }) => Promise<unknown> } };

export type AuditEntry = {
  actorId: string | null;
  actorKind?: "user" | "ai" | "system";
  action: string;
  entityType: string;
  entityId?: string | null;
  diff?: unknown;
  ip?: string | null;
};

/** 모든 쓰기 동작은 같은 트랜잭션 안에서 이 함수로 기록한다(지시서 4-1). diff 는 항상 마스킹된다. */
export async function writeAudit(tx: TxLike, e: AuditEntry): Promise<void> {
  await tx.activityLog.create({
    data: {
      actor_id: e.actorId,
      actor_kind: e.actorKind ?? (e.actorId ? "user" : "system"),
      action: e.action,
      entity_type: e.entityType,
      entity_id: e.entityId ?? null,
      diff: e.diff === undefined ? undefined : (maskDeep(e.diff) as Prisma.InputJsonValue),
      ip: e.ip ?? null,
    },
  });
}
