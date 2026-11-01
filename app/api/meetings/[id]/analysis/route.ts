import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { editAnalysis } from "@/lib/services/meetings";

export const dynamic = "force-dynamic";

/** 정리본 편집 → 새 버전 (8-3) */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => Response.json(await editAnalysis(prisma, u, (await params).id, await readJson(req))));
}
