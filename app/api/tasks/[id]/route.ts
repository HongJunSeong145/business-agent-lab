import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { deleteTask, getTaskDetail, updateTask } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: P) {
  return withUser(async (u) => Response.json(await getTaskDetail(prisma, u, (await params).id), { headers: { "Cache-Control": "no-store" } }));
}

export async function PATCH(req: Request, { params }: P) {
  return withUser(async (u) => {
    await updateTask(prisma, u, (await params).id, await readJson(req));
    return Response.json({ ok: true });
  });
}

export async function DELETE(_req: Request, { params }: P) {
  return withUser(async (u) => {
    return Response.json({ ok: true, ...(await deleteTask(prisma, u, (await params).id)) });
  });
}
