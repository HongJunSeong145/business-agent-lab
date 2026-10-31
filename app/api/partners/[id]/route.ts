import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { deletePartner, updatePartner } from "@/lib/services/partners";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };
export async function PATCH(req: Request, { params }: P) {
  return withUser(async (u) => (await updatePartner(prisma, u, (await params).id, await readJson(req)), Response.json({ ok: true })));
}
export async function DELETE(_req: Request, { params }: P) {
  return withUser(async (u) => (await deletePartner(prisma, u, (await params).id), Response.json({ ok: true })));
}
