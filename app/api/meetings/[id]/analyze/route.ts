import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { requestAnalysis } from "@/lib/services/analysis";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => Response.json(await requestAnalysis(prisma, u, (await params).id), { status: 202 }));
}
