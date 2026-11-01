import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { requestDeadlineChange } from "@/lib/services/proposals";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => Response.json({ id: (await requestDeadlineChange(prisma, u, (await params).id, await readJson(req))).id }, { status: 201 }));
}
