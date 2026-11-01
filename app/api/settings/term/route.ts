import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { updateTerm } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  return withUser(async (u) => {
    await updateTerm(prisma, u, await readJson(req));
    return Response.json({ ok: true });
  });
}
