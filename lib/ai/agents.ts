import type { Db } from "@/lib/db";
import { maskText } from "@/lib/audit/mask";
import { toParagraphs } from "@/lib/minutes-text";
import { dateColumnToString } from "@/lib/utils";
import { todayKst } from "@/lib/clock";
import { loadRuleParams } from "@/lib/rule-params";
import { getNumberSetting } from "@/lib/settings";
import { notifyLeaders } from "@/lib/services/notifications";
import type { FundingSource } from "@kgb/rules";
import { AiTransientError, AiUnavailableError, type AiProvider } from "./provider";
import { AiBudgetExceededError, AiOutputInvalidError, callStructured } from "./structured";
import { groundAll, numbered, type Paragraph } from "./grounding";
import { a1Schema, type A1Summary } from "./schemas/a1";
import { a2Schema } from "./schemas/a2";
import { A1_PROMPT_VERSION, A1_SYSTEM, a1Prompt } from "./prompts/a1";
import { A2_PROMPT_VERSION, A2_SYSTEM, a2Prompt } from "./prompts/a2";
import { buildProposals, type ExistingProject } from "./propose";

/**
 * 오케스트레이터의 AI 작업 (6-4):
 *   analyze_meeting(A1) → propose_work(A2 + 규칙 엔진 A3·A4) → meeting.analyzed + "검토 대기 N건" 알림
 * Agent 는 meeting_analyses·proposals·notifications·ai_runs 만 쓴다 — 확정 데이터(사업·업무)는 승인 API 만 만든다(6-1).
 */
export const MAX_AI_ATTEMPTS = 3;
const MEETING_TYPE: Record<string, string> = { regular: "정기회의", extraordinary: "임시회의", department: "국서 회의", other: "기타" };

export type AiJobOutcome = "succeeded" | "failed" | "skipped" | "waiting_budget";

async function claim(db: Db, aiJobId: string, type: string) {
  const r = await db.aiJob.updateMany({ where: { id: aiJobId, type, status: "queued" }, data: { status: "running", started_at: new Date(), attempts: { increment: 1 }, error: null } });
  if (r.count !== 1) return null;
  return db.aiJob.findUniqueOrThrow({ where: { id: aiJobId } });
}

/** 공통 오류 처리: 예산 초과는 대기, 키·형식 오류는 실패 확정, 일시 오류는 재시도(마지막이면 실패) */
async function handleError(db: Db, job: { id: string; attempts: number; payload: unknown }, meetingId: string, termId: string, e: unknown): Promise<AiJobOutcome> {
  const done = (status: "failed" | "waiting_budget", error: string) =>
    db.aiJob.update({ where: { id: job.id }, data: { status, error, finished_at: status === "failed" ? new Date() : null } });
  await db.meeting.update({ where: { id: meetingId }, data: { status: "extracted" } });
  if (e instanceof AiBudgetExceededError) {
    await done("waiting_budget", "budget_exceeded");
    await db.$transaction((tx) => notifyLeaders(tx, termId, { type: "ai_budget", title: "오늘 AI 예산을 모두 썼습니다", body: "회의록 분석이 내일 이어서 진행됩니다. 예산은 설정에서 바꿀 수 있습니다.", severity: "warn", dedupeKey: `ai-budget:${todayKst()}` }));
    return "waiting_budget";
  }
  if (e instanceof AiUnavailableError) {
    await done("failed", `ai_unavailable: ${e.message}`);
    return "failed";
  }
  if (e instanceof AiOutputInvalidError) {
    await done("failed", `output_invalid: ${e.message.slice(0, 300)}`);
    return "failed";
  }
  if (job.attempts >= MAX_AI_ATTEMPTS) {
    await done("failed", `transient_exhausted: ${(e as Error).message?.slice(0, 300)}`);
    return "failed";
  }
  await db.aiJob.update({ where: { id: job.id }, data: { status: "queued", error: (e as Error).message?.slice(0, 300) ?? "error" } });
  throw e instanceof AiTransientError ? e : new AiTransientError((e as Error).message ?? "error");
}

async function aiSettings(db: Db, termId: string) {
  return {
    budgetKrw: await getNumberSetting(db, termId, "AI_DAILY_BUDGET_KRW", 3000),
    usdKrw: Number(process.env.USD_KRW ?? 1400),
  };
}

function maskedParagraphs(text: string): Paragraph[] {
  return toParagraphs(text).map((p) => ({ n: p.n, text: maskText(p.text) }));
}

export async function runAnalyzeJob(db: Db, provider: AiProvider, aiJobId: string): Promise<{ outcome: AiJobOutcome; nextJobId?: string }> {
  const job = await claim(db, aiJobId, "analyze_meeting");
  if (!job) return { outcome: "skipped" };
  const { meetingId } = job.payload as { meetingId: string };
  const meeting = await db.meeting.findUnique({ where: { id: meetingId }, include: { files: { orderBy: { created_at: "desc" }, take: 1 } } });
  const text = meeting?.files[0]?.extracted_text;
  if (!meeting || meeting.deleted_at || !text) {
    await db.aiJob.update({ where: { id: aiJobId }, data: { status: "failed", error: "no_text", finished_at: new Date() } });
    return { outcome: "failed" };
  }
  await db.meeting.update({ where: { id: meetingId }, data: { status: "analyzing" } });
  try {
    const paragraphs = maskedParagraphs(text);
    const meetingDate = dateColumnToString(meeting.meeting_date);
    const projects = await db.project.findMany({ where: { term_id: meeting.term_id, deleted_at: null, status: { notIn: ["cancelled", "done"] } }, select: { title: true, event_start: true } });
    const s = await aiSettings(db, meeting.term_id);
    const raw = await callStructured(db, provider, {
      agent: "a1",
      promptVersion: A1_PROMPT_VERSION,
      schema: a1Schema,
      jobId: aiJobId,
      ...s,
      system: A1_SYSTEM,
      documents: [{ name: "회의록", content: numbered(paragraphs) }],
      prompt: a1Prompt({ title: meeting.title, meetingDate, meetingType: MEETING_TYPE[meeting.meeting_type] ?? meeting.meeting_type, projects: projects.map((p) => ({ title: p.title, event_start: p.event_start ? dateColumnToString(p.event_start) : null })) }),
      mockContext: { paragraphs, meetingDate },
    });
    const summary = groundAll(raw, paragraphs);
    const last = await db.meetingAnalysis.findFirst({ where: { meeting_id: meetingId }, orderBy: { version: "desc" } });
    return await db.$transaction(async (tx) => {
      await tx.meetingAnalysis.create({
        data: { meeting_id: meetingId, version: (last?.version ?? 0) + 1, summary: summary as object, model: provider.model, prompt_version: A1_PROMPT_VERSION, created_by_job_id: aiJobId },
      });
      const next = await tx.aiJob.create({ data: { type: "propose_work", payload: { meetingId }, idempotency_key: `propose:${aiJobId}` } });
      await tx.aiJob.update({ where: { id: aiJobId }, data: { status: "succeeded", finished_at: new Date() } });
      return { outcome: "succeeded" as const, nextJobId: next.id };
    });
  } catch (e) {
    return { outcome: await handleError(db, job, meetingId, meeting.term_id, e) };
  }
}

export async function runProposeJob(db: Db, provider: AiProvider, aiJobId: string): Promise<{ outcome: AiJobOutcome; proposals?: number }> {
  const job = await claim(db, aiJobId, "propose_work");
  if (!job) return { outcome: "skipped" };
  const { meetingId } = job.payload as { meetingId: string };
  const meeting = await db.meeting.findUnique({
    where: { id: meetingId },
    include: { analyses: { orderBy: { version: "desc" }, take: 1 }, files: { orderBy: { created_at: "desc" }, take: 1 } },
  });
  const analysis = meeting?.analyses[0];
  if (!meeting || meeting.deleted_at || !analysis) {
    await db.aiJob.update({ where: { id: aiJobId }, data: { status: "failed", error: "no_analysis", finished_at: new Date() } });
    return { outcome: "failed" };
  }
  try {
    const termId = meeting.term_id;
    const meetingDate = dateColumnToString(meeting.meeting_date);
    const paragraphs = maskedParagraphs(meeting.files[0]?.extracted_text ?? "");
    const projects = await db.project.findMany({
      where: { term_id: termId, deleted_at: null, status: { notIn: ["cancelled", "done"] } },
      include: { funding_sources: true, tasks: { where: { deleted_at: null, status: { not: "cancelled" } }, select: { title: true, template_key: true } } },
    });
    const existing: ExistingProject[] = projects.map((p) => ({
      id: p.id, title: p.title, event_start: p.event_start ? dateColumnToString(p.event_start) : null, venue: p.venue, expected_beneficiaries: p.expected_beneficiaries,
      uses_external_vendor: p.uses_external_vendor, funding: p.funding_sources.map((f) => f.source as FundingSource), tasks: p.tasks,
    }));
    const summary = analysis.summary as unknown as A1Summary;
    const s = await aiSettings(db, termId);
    const raw = await callStructured(db, provider, {
      agent: "a2",
      promptVersion: A2_PROMPT_VERSION,
      schema: a2Schema,
      jobId: aiJobId,
      ...s,
      system: A2_SYSTEM,
      prompt: a2Prompt({ meetingDate, summaryJson: JSON.stringify(summary), projects: existing.map((p) => ({ id: p.id, title: p.title, event_start: p.event_start, tasks: p.tasks.map((t) => t.title) })) }),
      mockContext: { summary, meetingDate, projects: existing.map((p) => ({ id: p.id, title: p.title })) },
    });
    const a2 = groundAll(raw, paragraphs);
    const members = await db.membership.findMany({ where: { term_id: termId }, include: { user: { select: { id: true, display_name: true } } } });
    const rows = buildProposals({
      meetingId, a2, existing, members: members.map((m) => ({ id: m.user.id, name: m.user.display_name })), params: await loadRuleParams(db, termId), today: todayKst(),
    });

    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`propose:${termId}`}))`;
      // 재분석: 이전 대기 제안은 대체(superseded), 이미 승인된 항목은 다시 제안하지 않는다(6-4, D9)
      await tx.proposal.updateMany({ where: { source_type: "meeting", source_id: meetingId, status: "pending" }, data: { status: "superseded" } });
      const decided = new Set(
        (await tx.proposal.findMany({ where: { dedupe_key: { in: rows.map((r) => r.dedupe_key) }, status: { in: ["approved", "edited_approved"] } }, select: { dedupe_key: true } })).map((r) => r.dedupe_key),
      );
      const fresh = rows.filter((r) => !decided.has(r.dedupe_key));
      const created = await tx.proposal.createMany({
        data: fresh.map((r) => ({ ...r, term_id: termId, source_type: "meeting", source_id: meetingId })),
        skipDuplicates: true,
      });
      await tx.meeting.update({ where: { id: meetingId }, data: { status: created.count > 0 ? "analyzed" : "reviewed" } });
      await tx.aiJob.update({ where: { id: aiJobId }, data: { status: "succeeded", finished_at: new Date() } });
      await tx.activityLog.create({ data: { actor_kind: "ai", action: "meeting.proposals", entity_type: "meeting", entity_id: meetingId, diff: { proposals: created.count, model: provider.model } } });
      if (created.count > 0) {
        await notifyLeaders(tx, termId, {
          type: "review_pending",
          title: `'${meeting.title}' 검토 대기 ${created.count}건`,
          body: "AI가 회의록에서 사업·업무를 제안했습니다. 확인 후 승인해 주세요.",
          link: "/review",
          dedupeKey: `review:${aiJobId}`,
        });
      }
      return { outcome: "succeeded" as const, proposals: created.count };
    });
  } catch (e) {
    return { outcome: await handleError(db, job, meetingId, meeting.term_id, e) };
  }
}
