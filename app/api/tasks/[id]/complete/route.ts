import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { setCompleted } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => {
    const body = (await readJson(req)) as { completed?: unknown };
    await setCompleted(prisma, u, (await params).id, body.completed === true);
    return Response.json({ ok: true });
  });
}
