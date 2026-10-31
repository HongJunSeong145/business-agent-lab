import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 배포 플랫폼 헬스체크 — 개인정보·설정값을 노출하지 않는다 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
