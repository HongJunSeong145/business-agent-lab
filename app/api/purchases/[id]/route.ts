import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { setPurchaseStatus } from "@/lib/services/finance";

export const dynamic = "force-dynamic";
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => (await setPurchaseStatus(prisma, u, (await params).id, await readJson(req)), Response.json({ ok: true })));
}
