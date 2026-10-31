import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { createTask } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return withUser(async (u) => Response.json({ id: (await createTask(prisma, u, await readJson(req))).id }, { status: 201 }));
}
