import "server-only";
import { prisma } from "@/lib/db";

/** 검토 화면용 직렬화 데이터 (8-4) */
export type ReviewEvidence = { para: number; quote: string; grounded?: boolean };
export type ReviewItem = {
  id: string;
  kind: "new_project" | "update_project" | "new_task" | "deadline" | "update_task" | "dependency" | "cancel";
  projectKey: string | null;
  title: string;
  inferred: boolean;
  inferenceReason: string | null;
  confidence: number | null;
  evidence: ReviewEvidence[];
  payload: Record<string, unknown>;
  before: Record<string, unknown> | null;
};
export type ReviewGroup = {
  id: string;
  label: string;
  meetingId: string | null;
  projects: { key: string; title: string; isNew: boolean; items: ReviewItem[] }[];
  others: ReviewItem[];
};

export async function loadReview(termId: string): Promise<ReviewGroup[]> {
  const props = await prisma.proposal.findMany({ where: { term_id: termId, status: "pending" }, orderBy: { created_at: "asc" } });
  const meetingIds = [...new Set(props.filter((p) => p.source_type === "meeting" && p.source_id).map((p) => p.source_id!))];
  const [meetings, projects, tasks] = await Promise.all([
    prisma.meeting.findMany({ where: { id: { in: meetingIds } }, select: { id: true, title: true, meeting_date: true } }),
    prisma.project.findMany({ where: { term_id: termId, id: { in: props.map((p) => p.target_id ?? p.project_key ?? "").filter((x) => /^[0-9a-f-]{36}$/.test(x)) } }, select: { id: true, title: true } }),
    prisma.task.findMany({ where: { id: { in: props.filter((p) => p.kind === "deadline").map((p) => p.target_id!) } }, select: { id: true, title: true } }),
  ]);
  const groups = new Map<string, ReviewGroup>();
  for (const p of props) {
    const gid = p.source_type === "meeting" ? p.source_id! : "manual";
    if (!groups.has(gid)) {
      const m = meetings.find((x) => x.id === gid);
      groups.set(gid, { id: gid, label: m ? `${m.title} (${m.meeting_date.toISOString().slice(0, 10)})` : "직접 요청 — 마감 변경", meetingId: m?.id ?? null, projects: [], others: [] });
    }
    const g = groups.get(gid)!;
    const payload = p.payload as Record<string, unknown>;
    const item: ReviewItem = {
      id: p.id,
      kind: p.kind as ReviewItem["kind"],
      projectKey: p.project_key,
      title: p.kind === "deadline" ? String(tasks.find((t) => t.id === p.target_id)?.title ?? payload.title ?? "업무") : String(payload.title ?? ""),
      inferred: p.inferred,
      inferenceReason: p.inference_reason,
      confidence: p.confidence === null ? null : Number(p.confidence),
      evidence: (p.evidence as ReviewEvidence[] | null) ?? [],
      payload,
      before: (p.before_snapshot as Record<string, unknown> | null) ?? null,
    };
    if (!p.project_key) {
      g.others.push(item);
      continue;
    }
    let pg = g.projects.find((x) => x.key === p.project_key);
    if (!pg) {
      const ex = projects.find((x) => x.id === p.project_key);
      pg = { key: p.project_key, title: ex?.title ?? "", isNew: !ex, items: [] };
      g.projects.push(pg);
    }
    if (p.kind === "new_project") pg.title = String(payload.title ?? pg.title);
    pg.items.push(item);
  }
  for (const g of groups.values()) for (const pg of g.projects) pg.items.sort((a, b) => (a.kind === "new_project" || a.kind === "update_project" ? -1 : 0) - (b.kind === "new_project" || b.kind === "update_project" ? -1 : 0));
  return [...groups.values()];
}
