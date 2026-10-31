import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { projectArchive } from "@/lib/services/deliverables";

export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => Response.json(await projectArchive(prisma, u, (await params).id)));
}
