import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { moveProjectDates } from "@/lib/services/projects";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => Response.json(await moveProjectDates(prisma, u, (await params).id, await readJson(req))));
}
