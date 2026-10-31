import type { Db } from "@/lib/db";
import type { Actor } from "@/lib/auth/can";
import { dateColumnToString } from "@/lib/utils";

/**
 * 전역 검색 (8-1 상단 검색): 사업·업무·회의록(제목·원문)·레퍼런스·연락망·인적사항(이름·직책·학과만).
 * 현재 기수 범위만, 각 종류 최대 10건. 개인 연락처 값(전화·메일·학번)으로는 검색하지 않는다.
 */
type ActorT = Actor & { termId: string };
export type SearchHit = { kind: "project" | "task" | "meeting" | "reference" | "contact" | "profile"; id: string; title: string; sub: string; href: string };

export async function globalSearch(db: Db, actor: ActorT, raw: string): Promise<SearchHit[]> {
  const q = raw.trim().slice(0, 100);
  if (q.length < 1) return [];
  const has = { contains: q, mode: "insensitive" as const };
  const termTask = { deleted_at: null, departments: { some: { role: "lead", department: { term_id: actor.termId } } } };
  const [projects, tasks, meetings, refs, contacts, profiles] = await Promise.all([
    db.project.findMany({ where: { term_id: actor.termId, deleted_at: null, OR: [{ title: has }, { venue: has }] }, take: 10, orderBy: { event_start: { sort: "desc", nulls: "last" } } }),
    db.task.findMany({
      where: { ...termTask, OR: [{ title: has }, { description: has }] },
      include: { project: { select: { title: true } }, departments: { where: { role: "lead" }, include: { department: { select: { code: true, name_ko: true } } } } },
      take: 10,
      orderBy: { due_date: { sort: "asc", nulls: "last" } },
    }),
    db.meeting.findMany({
      where: { term_id: actor.termId, deleted_at: null, OR: [{ title: has }, { files: { some: { extracted_text: has } } }] },
      include: { files: { take: 1, orderBy: { created_at: "desc" }, select: { extracted_text: true } } },
      take: 10,
      orderBy: { meeting_date: "desc" },
    }),
    db.referenceItem.findMany({
      where: { deleted_at: null, task: termTask, OR: [{ title: has }, { summary: has }, { content: has }] },
      include: { task: { select: { id: true, title: true, departments: { where: { role: "lead" }, include: { department: { select: { code: true } } } } } } },
      take: 10,
    }),
    db.contactRow.findMany({ where: { term_id: actor.termId, deleted_at: null }, take: 500 }),
    db.memberProfile.findMany({ where: { term_id: actor.termId, deleted_at: null, OR: [{ name: has }, { position_title: has }, { major: has }] }, take: 10 }),
  ]);
  const snippet = (text: string | null | undefined) => {
    if (!text) return "";
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return "";
    return `…${text.slice(Math.max(0, i - 30), i + q.length + 40).replace(/\s+/g, " ")}…`;
  };
  const lower = q.toLowerCase();
  return [
    ...projects.map((p) => ({ kind: "project" as const, id: p.id, title: p.title, sub: [p.event_start ? dateColumnToString(p.event_start) : "날짜 미정", p.venue].filter(Boolean).join(" · "), href: `/projects/${p.id}` })),
    ...tasks.map((t) => {
      const lead = t.departments[0]?.department;
      return { kind: "task" as const, id: t.id, title: t.title, sub: [lead?.name_ko, t.project?.title ?? "사업 외 업무", t.due_date ? `마감 ${dateColumnToString(t.due_date)}` : null].filter(Boolean).join(" · "), href: `/departments/${lead?.code ?? "planning"}?task=${t.id}` };
    }),
    ...meetings.map((m) => ({ kind: "meeting" as const, id: m.id, title: m.title, sub: `${dateColumnToString(m.meeting_date)} ${snippet(m.files[0]?.extracted_text)}`.trim(), href: `/minutes?id=${m.id}` })),
    ...refs.map((r) => ({ kind: "reference" as const, id: r.id, title: r.title, sub: `업무 '${r.task?.title ?? ""}' 레퍼런스`, href: `/departments/${r.task?.departments[0]?.department.code ?? "planning"}?task=${r.task_id}&tab=references` })),
    ...contacts
      .filter((c) => Object.values((c.data ?? {}) as Record<string, string>).some((v) => String(v).toLowerCase().includes(lower)))
      .slice(0, 10)
      .map((c) => {
        const d = (c.data ?? {}) as Record<string, string>;
        return { kind: "contact" as const, id: c.id, title: d.org || d.contact_person || "연락처", sub: [d.category, d.contact_person, d.note].filter(Boolean).join(" · "), href: `/#contacts` };
      }),
    ...profiles.map((p) => ({ kind: "profile" as const, id: p.id, title: p.name, sub: [p.position_title, p.major].filter(Boolean).join(" · "), href: `/#members` })),
  ];
}
