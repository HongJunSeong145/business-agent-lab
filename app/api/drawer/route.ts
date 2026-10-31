import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { dateColumnToString } from "@/lib/utils";
import { MEETING_STATUS_LABEL } from "@/lib/services/meetings";

export const dynamic = "force-dynamic";

// 업무 상세는 /api/tasks/[id] (업무 드로어 전용)
const query = z.object({ type: z.enum(["meeting", "project"]), id: z.string().uuid() });

/** 드로어 셸용 기본 정보 (로그인 필수, 현재 기수 범위만) */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return Response.json({ error: "not_found" }, { status: 404 });
  const { type, id } = parsed.data;

  if (type === "meeting") {
    const m = await prisma.meeting.findFirst({
      where: { id, term_id: user.termId, deleted_at: null },
      include: { files: { orderBy: { created_at: "desc" }, take: 1 } },
    });
    if (!m) return Response.json({ error: "not_found" }, { status: 404 });
    const f = m.files[0];
    const text = f?.extracted_text ?? "";
    return Response.json({
      title: m.title,
      fields: [
        { label: "회의일", value: dateColumnToString(m.meeting_date) },
        { label: "상태", value: MEETING_STATUS_LABEL[m.status] ?? m.status },
        { label: "파일", value: f?.original_name ?? "-" },
      ],
      preview: f?.extraction_error ?? (text ? text.slice(0, 1200) + (text.length > 1200 ? "\n…" : "") : null),
      link: { href: `/minutes?id=${m.id}`, label: "회의록 공간에서 전체 보기" },
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
