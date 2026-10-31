import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { setManualProgress } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => {
    await setManualProgress(prisma, u, (await params).id, await readJson(req));
    return Response.json({ ok: true });
  });
}
