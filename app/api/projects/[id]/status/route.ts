import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { setProjectStatus } from "@/lib/services/projects";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => {
    await setProjectStatus(prisma, u, (await params).id, await readJson(req));
    return Response.json({ ok: true });
  });
}
