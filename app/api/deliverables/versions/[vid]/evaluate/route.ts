import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { dispatchJob } from "@/lib/jobs/queue";
import { requestEvaluation } from "@/lib/services/deliverables";

export const dynamic = "force-dynamic";

/** 다시 평가 */
export async function POST(_req: Request, { params }: { params: Promise<{ vid: string }> }) {
  return withUser(async (u) => {
    const r = await requestEvaluation(prisma, u, (await params).vid);
    await dispatchJob(r.aiJobId, "evaluate_deliverable");
    return Response.json(r, { status: 202 });
  });
}
