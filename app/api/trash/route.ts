import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { listDeletedTasks } from "@/lib/services/tasks";
import { listDeletedProjects } from "@/lib/services/projects";
import { listDismissedEvents } from "@/lib/services/schedule-events";

export const dynamic = "force-dynamic";

/** 최근 삭제한 사업·업무(되살리기 목록) — ?project=…&dept=… */
export async function GET(req: Request) {
  return withUser(async (u) => {
    const sp = new URL(req.url).searchParams;
    const projectId = sp.get("project") ?? undefined;
    const deptCode = sp.get("dept") ?? undefined;
    const [tasks, projects, events] = await Promise.all([
      listDeletedTasks(prisma, u, { projectId, deptCode }),
      projectId || deptCode ? Promise.resolve([]) : listDeletedProjects(prisma, u),
      deptCode ? Promise.resolve([]) : listDismissedEvents(prisma, u, projectId),
    ]);
    return Response.json({ tasks, projects, events }, { headers: { "Cache-Control": "no-store" } });
  });
}
