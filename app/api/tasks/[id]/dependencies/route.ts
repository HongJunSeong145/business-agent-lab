import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { addDependency } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => Response.json({ id: (await addDependency(prisma, u, (await params).id, await readJson(req))).id }, { status: 201 }));
}
