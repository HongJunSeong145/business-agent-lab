import type { Db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { dateColumnToString } from "@/lib/utils";
import { todayKst } from "@/lib/clock";
import { loadRuleParams } from "@/lib/rule-params";
import { getNumberSetting } from "@/lib/settings";
import { maskText } from "@/lib/audit/mask";
import { notifyLeaders } from "@/lib/services/notifications";
import { planFieldsSchema, planToText } from "@/lib/services/plans";
import { computeSchedule, type FundingSource } from "@kgb/rules";
import { AiTransientError, AiUnavailableError, type AiProvider } from "./provider";
import { AiBudgetExceededError, AiOutputInvalidError, callStructured } from "./structured";
import { a2pSchema } from "./schemas/a2p";
import { A2P_PROMPT_VERSION, A2P_SYSTEM, a2pPrompt } from "./prompts/a2p";
import { MAX_AI_ATTEMPTS, type AiJobOutcome } from "./agents";

/**
 * 결재 기획안 기준 재배정 (사용자 결정 2026-10-31 — "모든 행사의 가장 중요한 기준은 최종 기획안").
 * 기획안이 결재되면:
 *  ① 코드: 기획안의 행사 날짜·장소가 사업과 다르면 '사업 정보 변경' 제안,
 *     표준 업무의 마감을 결재 기획안 행사일로 다시 계산해 달라진 것은 '마감 변경' 제안
 *  ② AI(있으면): 기획안 내용과 어긋나는 업무 수정·추가·취소 제안
 *  → 모두 검토 화면의 '승인 요청'으로 올린다(자동 반영하지 않음). 이전 회의록 기반의 대기 제안은 대체된다.
 */
export async function runPlanRebaseJob(db: Db, provider: AiProvider | null, aiJobId: string): Promise<{ outcome: AiJobOutcome; proposals?: number; usedAi?: boolean }> {
  const claimed = await db.aiJob.updateMany({ where: { id: aiJobId, type: "plan_rebase", status: "queued" }, data: { status: "running", started_at: new Date(), attempts: { increment: 1 }, error: null } });
  if (claimed.count !== 1) return { outcome: "skipped" };
  const job = await db.aiJob.findUniqueOrThrow({ where: { id: aiJobId } });
  const { projectId, planVersionId, approverId } = job.payload as { projectId: string; planVersionId: string; approverId: string };
  const version = await db.planVersion.findUnique({ where: { id: planVersionId }, include: { plan: true } });
  const project = await db.project.findFirst({
    where: { id: projectId, deleted_at: null },
    include: {
      funding_sources: true,
      tasks: { where: { deleted_at: null }, include: { departments: { include: { department: { select: { code: true } } } } }, orderBy: { created_at: "asc" } },
    },
  });
  if (!version || !project || !version.approved_at) {
    await db.aiJob.update({ where: { id: aiJobId }, data: { status: "failed", error: "plan_or_project_missing", finished_at: new Date() } });
    return { outcome: "failed" };
  }
  const termId = project.term_id;
  const f = planFieldsSchema.parse(version.fields);
  const today = todayKst();
  const rows: Prisma.ProposalCreateManyInput[] = [];
  const base = { term_id: termId, source_type: "plan", source_id: version.id, project_key: project.id };
  const key = (k: string) => `plan:${version.id}:${k}`;

  // ① 사업 정보(행사일·장소)
  const curDate = project.event_start ? dateColumnToString(project.event_start) : null;
  const changes: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  if (f.event_date && f.event_date !== curDate) (changes.event_start = f.event_date), (before.event_start = curDate);
  if (f.venue && f.venue !== (project.venue ?? "")) (changes.venue = f.venue), (before.venue = project.venue);
  if (Object.keys(changes).length) {
    rows.push({ ...base, kind: "update_project", target_id: project.id, payload: { title: project.title, changes, reason: `결재 기획안 v${version.version_no}` } as Prisma.InputJsonValue, before_snapshot: before as Prisma.InputJsonValue, inferred: false, confidence: 1, dedupe_key: key("project") });
  }

  // ① 표준 업무 마감 — 결재 기획안의 행사일 기준
  const eventDate = f.event_date || curDate;
  const active = project.tasks.filter((t) => !t.is_completed && t.status !== "cancelled" && t.status !== "done");
  const dueChanged = new Set<string>();
  if (eventDate) {
    const params = await loadRuleParams(db, termId);
    const sched = computeSchedule({ eventStart: eventDate, today, funding: project.funding_sources.map((x) => x.source as FundingSource), usesVendor: project.uses_external_vendor, params }, false);
    for (const t of active) {
      const s = t.template_key ? sched.tasks.find((x) => x.key === t.template_key) : undefined;
      if (!s?.due) continue;
      const cur = t.due_date ? dateColumnToString(t.due_date) : null;
      if (cur === s.due) continue;
      dueChanged.add(t.id);
      rows.push({
        ...base, kind: "deadline", target_id: t.id,
        payload: { title: t.title, due_date: s.due, reason: `결재 기획안 v${version.version_no} 행사일(${eventDate}) 기준: ${s.reason}`, requested_by: approverId, before_due: cur },
        before_snapshot: { due_date: cur } as Prisma.InputJsonValue, inferred: false, confidence: 1, dedupe_key: key(`due:${t.id}`),
      });
    }
  }

  // ② AI: 기획안과 어긋나는 업무 수정·추가·취소
  let usedAi = false;
  let aiNote: string | null = null;
  if (provider?.available) {
    const list = project.tasks.filter((t) => t.status !== "cancelled").map((t, i) => {
      const lead = t.departments.find((d) => d.role === "lead")?.department.code ?? "planning";
      return { ref: `T${i + 1}`, id: t.id, title: t.title, lead, support: t.departments.filter((d) => d.role === "support").map((d) => d.department.code), due: t.due_date ? dateColumnToString(t.due_date) : null, template_key: t.template_key, status: t.is_completed ? "완료" : t.status, done: t.is_completed || t.status === "done" };
    });
    try {
      const out = await callStructured(db, provider, {
        agent: "a2p", promptVersion: A2P_PROMPT_VERSION, schema: a2pSchema, jobId: aiJobId,
        budgetKrw: await getNumberSetting(db, termId, "AI_DAILY_BUDGET_KRW", 3000), usdKrw: Number(process.env.USD_KRW ?? 1400), maxTokens: 8000,
        system: A2P_SYSTEM,
        documents: [{ name: "결재 기획안", content: maskText(planToText(f)) }],
        prompt: a2pPrompt({ projectTitle: project.title, planVersion: version.version_no, tasks: list }),
        mockContext: { plan: f, tasks: list },
      });
      usedAi = true;
      aiNote = out.notes;
      const byRef = new Map(list.map((t) => [t.ref, t]));
      for (const u of out.update_tasks) {
        const t = byRef.get(u.task_ref);
        if (!t || t.done) continue;
        const ch: Record<string, unknown> = {};
        const bf: Record<string, unknown> = {};
        if (u.title && u.title !== t.title) (ch.title = u.title), (bf.title = t.title);
        if (u.description) ch.description = u.description;
        if (u.lead_department && u.lead_department !== t.lead) (ch.lead_department = u.lead_department), (bf.lead_department = t.lead);
        if (u.support_departments && u.support_departments.join() !== t.support.join()) (ch.support_departments = u.support_departments), (bf.support_departments = t.support);
        if (u.due_date && !t.template_key && u.due_date !== t.due && u.due_date >= today && !dueChanged.has(t.id)) (ch.due_date = u.due_date), (bf.due_date = t.due);
        if (!Object.keys(ch).length) continue;
        rows.push({ ...base, kind: "update_task", target_id: t.id, payload: { title: t.title, changes: ch, reason: u.reason } as Prisma.InputJsonValue, before_snapshot: bf as Prisma.InputJsonValue, inferred: false, confidence: 0.8, dedupe_key: key(`upd:${t.id}`) });
      }
      for (const c of out.cancel_tasks) {
        const t = byRef.get(c.task_ref);
        if (!t || t.done) continue;
        rows.push({ ...base, kind: "cancel", target_id: t.id, payload: { title: t.title, reason: c.reason }, inferred: false, confidence: 0.7, dedupe_key: key(`cancel:${t.id}`) });
      }
      for (const [i, a] of out.add_tasks.entries()) {
        if (list.some((t) => t.title.replace(/\s/g, "") === a.title.replace(/\s/g, ""))) continue;
        rows.push({
          ...base, kind: "new_task", target_id: project.id,
          payload: {
            title: a.title, description: a.description, lead_department: a.lead_department, support_departments: a.support_departments.filter((s) => s !== a.lead_department),
            template_key: a.template_key, assignee_ids: [], due_date: a.due_date && a.due_date >= today ? a.due_date : null,
            due_reason: a.due_date ? `결재 기획안 v${version.version_no}` : null, due_feasible: true, acceptance_criteria: [], project_id: project.id, project_title: project.title,
          } as Prisma.InputJsonValue,
          inferred: false, inference_reason: a.reason, confidence: 0.75, dedupe_key: key(`add:${i}:${a.title}`),
        });
      }
    } catch (e) {
      if (e instanceof AiBudgetExceededError) aiNote = "오늘 AI 예산을 모두 써서 AI 점검은 건너뛰었습니다(날짜·마감 제안만).";
      else if (e instanceof AiUnavailableError || e instanceof AiOutputInvalidError) aiNote = "AI 점검 실패 — 날짜·마감 제안만 올렸습니다.";
      else if (job.attempts < MAX_AI_ATTEMPTS) {
        await db.aiJob.update({ where: { id: aiJobId }, data: { status: "queued", error: (e as Error).message?.slice(0, 300) } });
        throw e instanceof AiTransientError ? e : new AiTransientError((e as Error).message ?? "error");
      } else aiNote = "AI 점검 실패 — 날짜·마감 제안만 올렸습니다.";
    }
  }

  const created = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`propose:${termId}`}))`;
    // 이전(회의록·이전 결재본) 기반 대기 제안은 결재 기획안 기준 제안으로 대체
    await tx.proposal.updateMany({
      where: { term_id: termId, status: "pending", OR: [{ project_key: project.id }, { target_id: project.id }, { target_id: { in: project.tasks.map((t) => t.id) } }], NOT: { source_type: "manual" } },
      data: { status: "superseded" },
    });
    const r = rows.length ? await tx.proposal.createMany({ data: rows, skipDuplicates: true }) : { count: 0 };
    await tx.aiJob.update({ where: { id: aiJobId }, data: { status: "succeeded", finished_at: new Date(), error: aiNote } });
    await tx.activityLog.create({ data: { actor_kind: usedAi ? "ai" : "system", action: "plan.rebase", entity_type: "project", entity_id: project.id, diff: { planVersion: version.version_no, proposals: r.count, usedAi, note: aiNote } } });
    await notifyLeaders(tx, termId, {
      type: "review_pending",
      title: r.count ? `'${project.title}' 결재 기획안 기준 재배정 제안 ${r.count}건 — 검토 대기` : `'${project.title}' 결재 기획안 점검: 바꿀 업무 없음`,
      body: aiNote ?? undefined,
      link: r.count ? "/review" : `/projects/${project.id}#plan`,
      dedupeKey: `plan-rebase:${version.id}`,
    });
    return r.count;
  });
  return { outcome: "succeeded", proposals: created, usedAi };
}
