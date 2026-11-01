import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { restoreScheduleEvent } from "@/lib/services/schedule-events";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => Response.json(await restoreScheduleEvent(prisma, u, (await params).id)));
}
