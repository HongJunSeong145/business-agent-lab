import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { addPartner, listPartners } from "@/lib/services/partners";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: P) {
  return withUser(async (u) => Response.json(await listPartners(prisma, u, (await params).id)));
}
export async function POST(req: Request, { params }: P) {
  return withUser(async (u) => Response.json({ id: (await addPartner(prisma, u, (await params).id, await readJson(req))).id }, { status: 201 }));
}
