import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { renameContactColumn, setContactColumnDeleted } from "@/lib/services/directory";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };
/** { label } 이름 변경 / { deleted: true|false } 삭제·되돌리기 */
export async function PATCH(req: Request, { params }: P) {
  return withUser(async (u) => {
    const id = (await params).id;
    const body = (await readJson(req)) as { label?: unknown; deleted?: unknown };
    if (typeof body.deleted === "boolean") await setContactColumnDeleted(prisma, u, id, body.deleted);
    else await renameContactColumn(prisma, u, id, body);
    return Response.json({ ok: true });
  });
}
