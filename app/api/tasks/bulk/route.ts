import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { bulkUpdateTasks } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";
/** 업무 일괄 수정 */
export async function POST(req: Request) {
  return withUser(async (u) => Response.json(await bulkUpdateTasks(prisma, u, await readJson(req))));
}
