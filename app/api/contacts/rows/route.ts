import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { createContactRow } from "@/lib/services/directory";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  return withUser(async (u) => Response.json({ id: (await createContactRow(prisma, u, await readJson(req))).id }, { status: 201 }));
}
