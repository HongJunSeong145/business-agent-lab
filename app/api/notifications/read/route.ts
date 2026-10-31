import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { markNotificationsRead } from "@/lib/services/notifications";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  return withUser(async (u) => {
    const ids = ((await readJson(req)) as { ids?: unknown }).ids;
    return Response.json({ updated: await markNotificationsRead(prisma, u.userId, Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string").slice(0, 100) : undefined) });
  });
}
