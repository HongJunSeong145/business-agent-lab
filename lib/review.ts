import "server-only";
import { prisma } from "@/lib/db";
import { dateColumnToString } from "@/lib/utils";
import { todayKst } from "@/lib/clock";
import { loadRuleParams } from "@/lib/rule-params";
import { computeSchedule, type FundingSource } from "@kgb/rules";

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
  /** 이 항목이 속한 주관 국서(새 업무는 제안값, 기존 업무 대상이면 그 업무의 주관 국서). 사업 단위 항목은 null */
  dept: string | null;
};
/** 이미 배정된 업무(맥락 표시용) — 행사일 변경 제안이 있으면 바뀔 마감 미리보기 */
export type ExistingRow = { id: string; title: string; dept: string; due: string | null; dueState: string; done: boolean; previewDue: string | null };
export type ReviewGroup = {
  id: string;
  label: string;
  meetingId: string | null;
  projects: { key: string; title: string; isNew: boolean; items: ReviewItem[]; existing: ExistingRow[] }[];
  others: ReviewItem[];
};

export async function loadReview(termId: string): Promise<ReviewGroup[]> {
  const props = await prisma.proposal.findMany({ where: { term_id: termId, status: "pending" }, orderBy: { created_at: "asc" } });
  const meetingIds = [...new Set(props.filter((p) => p.source_type === "meeting" && p.source_id).map((p) => p.source_id!))];
  const planIds = [...new Set(props.filter((p) => p.source_type === "plan" && p.source_id).map((p) => p.source_id!))];
  const planVersions = await prisma.planVersion.findMany({ where: { id: { in: planIds } }, select: { id: true, version_no: true, plan: { select: { project: { select: { title: true } } } } } });
  const [meetings, projects, tasks] = await Promise.all([
    prisma.meeting.findMany({ where: { id: { in: meetingIds } }, select: { id: true, title: true, meeting_date: true } }),
    prisma.project.findMany({ where: { term_id: termId, id: { in: [...new Set(props.flatMap((p) => [p.target_id, p.project_key]))].filter((x): x is string => Boolean(x && /^[0-9a-f-]{36}$/.test(x))) } }, select: { id: true, title: true } }),
    prisma.task.findMany({
      where: { id: { in: props.filter((p) => ["deadline", "update_task", "cancel"].includes(p.kind)).map((p) => p.target_id!) } },
      select: { id: true, title: true, departments: { where: { role: "lead" }, select: { department: { select: { code: true } } } } },
    }),
  ]);
  const groups = new Map<string, ReviewGroup>();
  for (const p of props) {
    const gid = p.source_type === "meeting" || p.source_type === "plan" ? p.source_id! : "manual";
    if (!groups.has(gid)) {
      const m = meetings.find((x) => x.id === gid);
      const pv = planVersions.find((x) => x.id === gid);
      const label = m
        ? `${m.title} (${m.meeting_date.toISOString().slice(0, 10)})`
        : pv
          ? `결재 기획안 기준 재배정 — ${pv.plan.project.title} 기획안 v${pv.version_no} (최종 기획안이 기준입니다)`
          : "직접 요청 — 마감 변경";
      groups.set(gid, { id: gid, label, meetingId: m?.id ?? null, projects: [], others: [] });
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
      dept:
        p.kind === "new_task"
          ? String(payload.lead_department ?? "")
          : ["deadline", "update_task", "cancel"].includes(p.kind)
            ? (tasks.find((t) => t.id === p.target_id)?.departments[0]?.department.code ?? null)
            : null,
    };
    if (!p.project_key) {
      g.others.push(item);
      continue;
    }
    let pg = g.projects.find((x) => x.key === p.project_key);
    if (!pg) {
      const ex = projects.find((x) => x.id === p.project_key);
      pg = { key: p.project_key, title: ex?.title ?? "", isNew: !ex, items: [], existing: [] };
      g.projects.push(pg);
    }
    if (p.kind === "new_project") pg.title = String(payload.title ?? pg.title);
    pg.items.push(item);
  }
  // 기존 사업: 이미 배정된 업무를 국서별 맥락으로 함께 보여 준다(행사일 변경 제안이 있으면 바뀔 마감 미리보기)
  const existingIds = [...new Set([...groups.values()].flatMap((g) => g.projects.filter((pg) => !pg.isNew).map((pg) => pg.key)))];
  if (existingIds.length) {
    const params = await loadRuleParams(prisma, termId);
    const full = await prisma.project.findMany({
      where: { id: { in: existingIds } },
      include: {
        funding_sources: true,
        tasks: { where: { deleted_at: null, status: { not: "cancelled" } }, include: { departments: { where: { role: "lead" }, include: { department: { select: { code: true } } } } }, orderBy: { due_date: { sort: "asc", nulls: "last" } } },
      },
    });
    for (const g of groups.values()) {
      for (const pg of g.projects) {
        const pr = full.find((x) => x.id === pg.key);
        if (!pr) continue;
        const change = pg.items.find((i) => i.kind === "update_project" && (i.payload.changes as Record<string, unknown> | undefined)?.event_start);
        const newDate = change ? String((change.payload.changes as Record<string, unknown>).event_start) : null;
        const sched = newDate
          ? computeSchedule({ eventStart: newDate, today: todayKst(), funding: pr.funding_sources.map((f) => f.source as FundingSource), usesVendor: pr.uses_external_vendor, params }, false)
          : null;
        pg.existing = pr.tasks.map((t) => {
          const s = sched && t.template_key && t.due_state === "proposed" && !t.is_completed ? sched.tasks.find((x) => x.key === t.template_key) : undefined;
          const due = t.due_date ? dateColumnToString(t.due_date) : null;
          return { id: t.id, title: t.title, dept: t.departments[0]?.department.code ?? "planning", due, dueState: t.due_state, done: t.is_completed || t.status === "done", previewDue: s?.due && s.due !== due ? s.due : null };
        });
      }
    }
  }
  for (const g of groups.values()) for (const pg of g.projects) pg.items.sort((a, b) => (a.kind === "new_project" || a.kind === "update_project" ? -1 : 0) - (b.kind === "new_project" || b.kind === "update_project" ? -1 : 0));
  return [...groups.values()];
}
