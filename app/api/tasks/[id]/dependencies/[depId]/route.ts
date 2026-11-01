import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { removeDependency } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; depId: string }> }) {
  return withUser(async (u) => {
    const { id, depId } = await params;
    await removeDependency(prisma, u, id, depId);
    return Response.json({ ok: true });
  });
}
