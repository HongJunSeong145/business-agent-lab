import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { approvePlan, rejectPlan, requestPlanReferences, submitPlan } from "@/lib/services/plans";
import { dispatchJob } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

/** 결재 요청 / 결재 / 반려 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  return withUser(async (u) => {
    const { id, action } = await params;
    if (action === "submit") return (await submitPlan(prisma, u, id), Response.json({ ok: true }));
    if (action === "approve") {
      const r = await approvePlan(prisma, u, id);
      await dispatchJob(r.rebaseJobId, "plan_rebase");
      return Response.json(r);
    }
    if (action === "references") {
      const r = await requestPlanReferences(prisma, u, id, await readJson(req));
      await dispatchJob(r.aiJobId, "reference");
      return Response.json(r, { status: 202 });
    }
    if (action === "reject") return (await rejectPlan(prisma, u, id, ((await readJson(req)) as { reason?: unknown }).reason), Response.json({ ok: true }));
    return Response.json({ error: "not_found" }, { status: 404 });
  });
}
