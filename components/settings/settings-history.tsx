import { prisma } from "@/lib/db";

const LABEL: Record<string, string> = { "settings.term": "기수·분기 변경", "settings.rules": "규칙 파라미터·휴일 변경" };

/** 설정 변경 이력 (5-7 "변경 이력을 남긴다") */
export async function SettingsHistory({ termId, action }: { termId: string; action: string }) {
  const logs = await prisma.activityLog.findMany({ where: { entity_id: termId, action }, orderBy: { created_at: "desc" }, take: 10 });
  const users = await prisma.user.findMany({ where: { id: { in: logs.map((l) => l.actor_id).filter(Boolean) as string[] } }, select: { id: true, display_name: true } });
  if (logs.length === 0) return <p className="text-sm text-muted">변경 이력이 없습니다.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {logs.map((l) => {
        const after = (l.diff as { after?: Record<string, unknown> } | null)?.after ?? {};
        return (
          <li key={l.id} className="flex gap-3">
            <time className="tabular w-32 shrink-0 text-xs text-muted">{l.created_at.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
            <span className="flex-1">{LABEL[l.action] ?? l.action}: {Object.keys(after).slice(0, 6).join(", ")}{Object.keys(after).length > 6 ? " …" : ""}</span>
            <span className="text-xs text-muted">{users.find((u) => u.id === l.actor_id)?.display_name ?? ""}</span>
          </li>
        );
      })}
    </ul>
  );
}
