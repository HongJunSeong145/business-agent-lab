import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { updateRuleSettings } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  return withUser(async (u) => Response.json(await updateRuleSettings(prisma, u, await readJson(req))));
}
