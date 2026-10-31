import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { listNotifications } from "@/lib/services/notifications";

export const dynamic = "force-dynamic";
export async function GET() {
  return withUser(async (u) => Response.json(await listNotifications(prisma, u.userId)));
}
