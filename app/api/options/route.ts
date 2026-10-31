import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";

export const dynamic = "force-dynamic";

/** 업무·사업 입력 폼의 선택지: 국서, 회원(담당자), 사업, 업무(선행 업무) */
export async function GET() {
  return withUser(async (u) => {
    const [departments, members, projects, tasks] = await Promise.all([
      prisma.department.findMany({ where: { term_id: u.termId }, orderBy: { display_order: "asc" }, select: { id: true, code: true, name_ko: true } }),
      prisma.membership.findMany({
        where: { term_id: u.termId },
        include: { user: { select: { id: true, display_name: true } }, department: { select: { name_ko: true } } },
        orderBy: { created_at: "asc" },
      }),
      prisma.project.findMany({ where: { term_id: u.termId, deleted_at: null, status: { not: "cancelled" } }, orderBy: { created_at: "desc" }, select: { id: true, title: true } }),
      prisma.task.findMany({
        where: { deleted_at: null, status: { not: "cancelled" }, departments: { some: { role: "lead", department: { term_id: u.termId } } } },
        orderBy: { created_at: "desc" },
        take: 500,
        select: { id: true, title: true, project: { select: { title: true } } },
      }),
    ]);
    return Response.json({
      departments,
      members: members.map((m) => ({ id: m.user.id, name: m.user.display_name, dept: m.department?.name_ko ?? null })),
      projects,
      tasks: tasks.map((t) => ({ id: t.id, title: t.title, project: t.project?.title ?? null })),
    });
  });
}
