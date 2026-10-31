import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { deleteDeliverable } from "@/lib/services/deliverables";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => {
    await deleteDeliverable(prisma, u, (await params).id);
    return Response.json({ ok: true });
  });
}
