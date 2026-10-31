import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { decideProposals } from "@/lib/services/proposals";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return withUser(async (u) => Response.json(await decideProposals(prisma, u, await readJson(req))));
}
