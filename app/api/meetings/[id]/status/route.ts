import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { unauthorized } from "@/lib/api";

export const dynamic = "force-dynamic";

/** 상태 폴링용 (추출 진행 표시) */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const m = await prisma.meeting.findFirst({ where: { id, term_id: user.termId, deleted_at: null }, select: { status: true } });
  if (!m) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ status: m.status }, { headers: { "Cache-Control": "no-store" } });
}
