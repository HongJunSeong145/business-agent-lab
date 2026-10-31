import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { approvePlan, rejectPlan, submitPlan } from "@/lib/services/plans";

export const dynamic = "force-dynamic";

/** 결재 요청 / 결재 / 반려 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  return withUser(async (u) => {
    const { id, action } = await params;
    if (action === "submit") return (await submitPlan(prisma, u, id), Response.json({ ok: true }));
    if (action === "approve") return Response.json(await approvePlan(prisma, u, id));
    if (action === "reject") return (await rejectPlan(prisma, u, id, ((await readJson(req)) as { reason?: unknown }).reason), Response.json({ ok: true }));
    return Response.json({ error: "not_found" }, { status: 404 });
  });
}
