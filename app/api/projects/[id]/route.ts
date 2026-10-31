import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { updateProject } from "@/lib/services/projects";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: P) {
  return withUser(async (u) => {
    await updateProject(prisma, u, (await params).id, await readJson(req));
    return Response.json({ ok: true });
  });
}
