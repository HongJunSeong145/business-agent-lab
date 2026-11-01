import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { deleteReference, updateReference } from "@/lib/services/references";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => {
    await deleteReference(prisma, u, (await params).id);
    return Response.json({ ok: true });
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => {
    await updateReference(prisma, u, (await params).id, await readJson(req));
    return Response.json({ ok: true });
  });
}
