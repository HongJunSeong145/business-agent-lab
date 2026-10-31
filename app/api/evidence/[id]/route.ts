import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { deleteEvidence, verifyEvidence } from "@/lib/services/finance";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };
/** 검수 { verified: boolean } */
export async function PATCH(req: Request, { params }: P) {
  return withUser(async (u) => (await verifyEvidence(prisma, u, (await params).id, ((await readJson(req)) as { verified?: unknown }).verified === true), Response.json({ ok: true })));
}
export async function DELETE(_req: Request, { params }: P) {
  return withUser(async (u) => (await deleteEvidence(prisma, u, (await params).id), Response.json({ ok: true })));
}
