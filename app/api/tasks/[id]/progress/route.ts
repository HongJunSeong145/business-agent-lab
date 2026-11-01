import { prisma } from "@/lib/db";
import { readJson, withUser } from "@/lib/api";
import { setManualProgress } from "@/lib/services/tasks";
import { afterTaskDone } from "@/lib/services/plan-sync";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => {
    const id = (await params).id;
    const body = (await readJson(req)) as { value?: unknown };
    await setManualProgress(prisma, u, id, body);
    // 기획안 업무를 수동 100% 로 두면 완료와 같이 기획안 결재로 반영
    const planNote = Number(body?.value) === 100 ? await afterTaskDone(prisma, u, id) : null;
    return Response.json({ ok: true, planNote });
  });
}
