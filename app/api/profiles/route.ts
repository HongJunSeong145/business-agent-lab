import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { createProfile, listProfiles } from "@/lib/services/directory";

export const dynamic = "force-dynamic";
export async function GET() {
  return withUser(async (u) => Response.json(await listProfiles(prisma, u)));
}
export async function POST(req: Request) {
  return withUser(async (u) => Response.json({ id: (await createProfile(prisma, u, await readJson(req))).id }, { status: 201 }));
}
