import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { bulkUpdateTasks } from "@/lib/services/tasks";
import { afterTaskDone } from "@/lib/services/plan-sync";

export const dynamic = "force-dynamic";
/** 업무 일괄 수정 */
export async function POST(req: Request) {
  return withUser(async (u) => {
    const body = (await readJson(req)) as { action?: string; ids?: string[] };
    const r = await bulkUpdateTasks(prisma, u, body);
    // 일괄 완료에 기획안 업무가 있으면 결재로 반영
    const notes = body.action === "complete" && Array.isArray(body.ids) ? (await Promise.all(body.ids.map((id) => afterTaskDone(prisma, u, id)))).filter(Boolean) : [];
    return Response.json({ ...r, planNote: notes[0] ?? null });
  });
}
