import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { setCompleted } from "@/lib/services/tasks";
import { afterTaskDone } from "@/lib/services/plan-sync";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => {
    const body = (await readJson(req)) as { completed?: unknown };
    const id = (await params).id;
    await setCompleted(prisma, u, id, body.completed === true);
    const planNote = body.completed === true ? await afterTaskDone(prisma, u, id) : null;
    return Response.json({ ok: true, planNote });
  });
}
