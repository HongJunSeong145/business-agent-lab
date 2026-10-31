import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { requestReextract } from "@/lib/services/meetings";
import { dispatchJob } from "@/lib/jobs/queue";
import { errorResponse, unauthorized } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  try {
    const { id } = await params;
    const r = await requestReextract(prisma, user, id);
    await dispatchJob(r.aiJobId, "extract");
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
