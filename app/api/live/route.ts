import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * 실시간 반영용 '변경 표시' — 업무·사업·제안·레퍼런스·작업물·기획안·재정·회의록 중 하나라도 바뀌면 값이 달라진다.
 * 화면은 몇 초마다 이 값만 확인하고, 달라졌을 때만 새로 그린다(진척도·캘린더·30일 일정·국서 공간이 함께 갱신).
 */
export async function GET() {
  return withUser(async () => {
    const rows = await prisma.$queryRaw<{ v: Date | null }[]>`
      SELECT GREATEST(
        (SELECT max(updated_at) FROM tasks), (SELECT max(updated_at) FROM projects), (SELECT max(updated_at) FROM proposals),
        (SELECT max(updated_at) FROM activity_logs), (SELECT max(updated_at) FROM reference_items), (SELECT max(updated_at) FROM reference_requests),
        (SELECT max(updated_at) FROM meetings), (SELECT max(updated_at) FROM plan_versions), (SELECT max(updated_at) FROM deliverable_versions),
        (SELECT max(updated_at) FROM deliverables), (SELECT max(updated_at) FROM progress_history), (SELECT max(updated_at) FROM budget_lines),
        (SELECT max(updated_at) FROM evidence_items)
      ) AS v`;
    return Response.json({ v: rows[0]?.v?.toISOString() ?? null }, { headers: { "Cache-Control": "no-store" } });
  });
}
