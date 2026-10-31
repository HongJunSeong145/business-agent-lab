import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { addBudgetLine, getQuarter, setPeriodStatus } from "@/lib/services/finance";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ quarter: string }> };
export async function GET(_req: Request, { params }: P) {
  return withUser(async (u) => Response.json(await getQuarter(prisma, u, Number((await params).quarter)), { headers: { "Cache-Control": "no-store" } }));
}
/** 예산 라인 추가 */
export async function POST(req: Request, { params }: P) {
  return withUser(async (u) => Response.json({ id: (await addBudgetLine(prisma, u, Number((await params).quarter), await readJson(req))).id }, { status: 201 }));
}
/** 예산안·결산안 상태 { kind, status } */
export async function PATCH(req: Request, { params }: P) {
  return withUser(async (u) => (await setPeriodStatus(prisma, u, Number((await params).quarter), await readJson(req)), Response.json({ ok: true })));
}
