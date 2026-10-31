import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { restoreProject } from "@/lib/services/projects";

export const dynamic = "force-dynamic";

/** 삭제한 사업 되살리기(함께 지운 업무 포함) */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => Response.json(await restoreProject(prisma, u, (await params).id)));
}
