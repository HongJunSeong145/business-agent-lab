import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { projectFinance } from "@/lib/services/finance";

export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => Response.json(await projectFinance(prisma, u, (await params).id)));
}
