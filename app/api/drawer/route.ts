import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { dateColumnToString } from "@/lib/utils";

export const dynamic = "force-dynamic";

const query = z.object({ type: z.enum(["task", "meeting", "project"]), id: z.string().uuid() });

const TASK_STATUS: Record<string, string> = {
  blocked: "차단", todo: "할 일", in_progress: "진행 중", review: "검토", done: "완료", cancelled: "취소",
};

/** 드로어 셸용 기본 정보 (로그인 필수, 현재 기수 범위만) */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return Response.json({ error: "not_found" }, { status: 404 });
  const { type, id } = parsed.data;

  if (type === "task") {
    const t = await prisma.task.findFirst({
      where: { id, deleted_at: null, OR: [{ project: { term_id: user.termId } }, { project_id: null, departments: { some: { department: { term_id: user.termId } } } }] },
      include: { project: true, departments: { include: { department: true } } },
    });
    if (!t) return Response.json({ error: "not_found" }, { status: 404 });
    const [progress] = await prisma.$queryRaw<{ effective_progress: number }[]>`SELECT effective_progress FROM task_progress WHERE task_id = ${t.id}::uuid`;
    return Response.json({
      title: t.title,
      fields: [
        { label: "사업", value: t.project?.title ?? "사업 외 업무" },
        { label: "국서", value: t.departments.map((d) => `${d.department.name_ko}(${d.role === "lead" ? "주관" : "협조"})`).join(", ") || "-" },
        { label: "상태", value: TASK_STATUS[t.status] ?? t.status },
        { label: "마감", value: t.due_date ? `${dateColumnToString(t.due_date)} (${t.due_state === "confirmed" ? "확정" : "제안"})` : "-" },
        { label: "진척도", value: `${progress?.effective_progress ?? 0}%` },
      ],
    });
  }
  if (type === "meeting") {
    const m = await prisma.meeting.findFirst({ where: { id, term_id: user.termId, deleted_at: null } });
    if (!m) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({
      title: m.title,
      fields: [
        { label: "회의일", value: dateColumnToString(m.meeting_date) },
        { label: "상태", value: m.status },
      ],
    });
  }
  const p = await prisma.project.findFirst({ where: { id, term_id: user.termId, deleted_at: null } });
  if (!p) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({
    title: p.title,
    fields: [
      { label: "행사일", value: p.event_start ? dateColumnToString(p.event_start) : "-" },
      { label: "상태", value: p.status },
      { label: "장소", value: p.venue ?? "-" },
    ],
  });
}
