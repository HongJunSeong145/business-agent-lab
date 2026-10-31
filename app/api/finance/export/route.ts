import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { quarterCsv } from "@/lib/services/finance";

export const dynamic = "force-dynamic";
/** CSV 내보내기 ?quarter=1..4 */
export async function GET(req: Request) {
  return withUser(async (u) => {
    const q = Number(new URL(req.url).searchParams.get("quarter") ?? 0);
    const csv = await quarterCsv(prisma, u, q);
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`예결산_${q}분기.csv`)}`, "Cache-Control": "no-store" },
    });
  });
}
