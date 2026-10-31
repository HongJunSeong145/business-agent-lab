import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { runMonitorNow } from "@/lib/services/monitor";
import { getProvider } from "@/lib/ai/runtime";

export const dynamic = "force-dynamic";
/** '지금 점검' — A7 수동 실행 (회장·국장) */
export async function POST() {
  return withUser(async (u) => {
    let provider = null;
    try {
      provider = getProvider();
    } catch {
      provider = null;
    }
    const r = await runMonitorNow(prisma, u, provider);
    return Response.json({ alerts: r.alerts.length, created: r.created, notices: r.notices, summary: r.summary, sentence: r.sentence });
  });
}
