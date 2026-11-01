import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { requestRepropose } from "@/lib/services/analysis";

export const dynamic = "force-dynamic";

/** 고친 정리본으로 업무 제안만 다시 만들기 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => Response.json(await requestRepropose(prisma, u, (await params).id), { status: 202 }));
}
