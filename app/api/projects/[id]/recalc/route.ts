import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { recalcAll } from "@/lib/services/schedule";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => Response.json(await recalcAll(prisma, u, (await params).id)));
}
