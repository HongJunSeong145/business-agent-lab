import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { addContactColumn } from "@/lib/services/directory";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  return withUser(async (u) => Response.json({ id: (await addContactColumn(prisma, u, await readJson(req))).id }, { status: 201 }));
}
