import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { restoreTask } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

/** 삭제한 업무 되살리기 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => Response.json(await restoreTask(prisma, u, (await params).id)));
}
