import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { createProject } from "@/lib/services/projects";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return withUser(async (u) => Response.json({ id: (await createProject(prisma, u, await readJson(req))).id }, { status: 201 }));
}
