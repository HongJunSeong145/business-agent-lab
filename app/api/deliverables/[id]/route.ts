import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { deleteDeliverable, updateDeliverable } from "@/lib/services/deliverables";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => {
    await deleteDeliverable(prisma, u, (await params).id);
    return Response.json({ ok: true });
  });
}

/** 이름 바꾸기·버전 메모·최종본 지정 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => {
    await updateDeliverable(prisma, u, (await params).id, await readJson(req));
    return Response.json({ ok: true });
  });
}
