import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { dismissScheduleEvent } from "@/lib/services/schedule-events";

export const dynamic = "force-dynamic";

/** 일정 항목 삭제(되살리기 가능) */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => Response.json(await dismissScheduleEvent(prisma, u, (await params).id)));
}
