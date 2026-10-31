import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { dispatchJob } from "@/lib/jobs/queue";
import { requestReferences } from "@/lib/services/references";

export const dynamic = "force-dynamic";

/** 레퍼런스 제작 의뢰 → A5 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => {
    const r = await requestReferences(prisma, u, (await params).id, await readJson(req));
    await dispatchJob(r.aiJobId, "reference");
    return Response.json(r, { status: 202 });
  });
}
