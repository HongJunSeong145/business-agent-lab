import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { applyStandardTemplate, getProjectSchedule } from "@/lib/services/schedule";
import type { TemplateKey } from "@kgb/rules";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

/** 표준 업무 미리보기 */
export async function GET(_req: Request, { params }: P) {
  return withUser(async (u) => Response.json(await getProjectSchedule(prisma, u, (await params).id)));
}

/** 표준 업무 만들기 { keys?: TemplateKey[] } */
export async function POST(req: Request, { params }: P) {
  return withUser(async (u) => {
    const body = (await readJson(req)) as { keys?: unknown };
    const keys = Array.isArray(body.keys) ? (body.keys.filter((k) => typeof k === "string") as TemplateKey[]) : undefined;
    return Response.json(await applyStandardTemplate(prisma, u, (await params).id, keys), { status: 201 });
  });
}
