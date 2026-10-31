import type { Db } from "@/lib/db";
import type { Storage } from "@/lib/storage";
import { maskText } from "@/lib/audit/mask";
import { dateColumnToString } from "@/lib/utils";
import { getNumberSetting } from "@/lib/settings";
import { setAiProgress } from "@/lib/services/tasks";
import { evaluability } from "@/lib/services/deliverables";
import { isImageMime } from "@/lib/files/deliverable";
import { planForContext, planToText } from "@/lib/services/plans";
import { AiTransientError, AiUnavailableError, type AiProvider, type CompleteRequest } from "./provider";
import { AiBudgetExceededError, AiOutputInvalidError, callStructured } from "./structured";
import { a6Schema, normalizeScore } from "./schemas/a6";
import { A6_PROMPT_VERSION, A6_SYSTEM, a6Prompt } from "./prompts/a6";
import { criteriaFor } from "./a6-criteria";
import { MAX_AI_ATTEMPTS, type AiJobOutcome } from "./agents";

/**
 * A6 작업물 평가 (6-2, T13): 기준별 판정 → 점수 → progress_evaluations 저장 → ai_progress 갱신.
 *  - ai_progress 만 쓴다. manual_progress·is_completed 는 건드리지 않는다(6-1 예외, T14).
 *  - 같은 업무에 더 최근에 올라온 버전이 있으면 평가는 기록만 하고 ai_progress 는 바꾸지 않는다("최신 버전 기준").
 */
const MAX_DOC_CHARS = 60_000;
const DEPT_KO: Record<string, string> = { planning: "기획국", finance: "재정국", secretariat: "사무국", promotion: "홍보국", operations: "집행국" };

export async function runEvaluateJob(db: Db, storage: Storage, provider: AiProvider, aiJobId: string): Promise<{ outcome: AiJobOutcome; score?: number; applied?: boolean }> {
  const claimed = await db.aiJob.updateMany({ where: { id: aiJobId, type: "evaluate_deliverable", status: "queued" }, data: { status: "running", started_at: new Date(), attempts: { increment: 1 }, error: null } });
  if (claimed.count !== 1) return { outcome: "skipped" };
  const job = await db.aiJob.findUniqueOrThrow({ where: { id: aiJobId } });
  const fail = async (error: string) => {
    await db.aiJob.update({ where: { id: aiJobId }, data: { status: "failed", error, finished_at: new Date() } });
    return { outcome: "failed" as const };
  };
  const { versionId } = job.payload as { versionId: string };
  const v = await db.deliverableVersion.findUnique({
    where: { id: versionId },
    include: {
      deliverable: {
        include: {
          task: {
            include: {
              departments: { include: { department: true } },
              project: { include: { funding_sources: true } },
            },
          },
        },
      },
    },
  });
  const task = v?.deliverable.task;
  if (!v || !task || v.deleted_at || v.deliverable.deleted_at || task.deleted_at) return fail("deliverable_missing");
  if (evaluability(v) !== "ok") return fail("not_evaluable");
  const lead = task.departments.find((d) => d.role === "lead")!.department;
  const termId = lead.term_id;

  try {
    let images: CompleteRequest["images"];
    let documents: CompleteRequest["documents"];
    if (isImageMime(v.mime)) {
      const bytes = await storage.get(v.storage_key!);
      if (!bytes) return fail("source_missing");
      images = [{ mediaType: v.mime as "image/png", base64: Buffer.from(bytes).toString("base64") }];
    } else {
      const text = maskText(v.extracted_text!);
      documents = [{ name: v.original_name ?? "작업물", content: text.length > MAX_DOC_CHARS ? `${text.slice(0, MAX_DOC_CHARS)}\n…(이하 생략)` : text }];
    }
    // 가장 중요한 기준은 결재된 최종 기획안(없으면 최신 초안, 초안이라고 표시)
    const plan = task.project_id ? await planForContext(db, task.project_id) : null;
    if (plan) documents = [...(documents ?? []), { name: `기획안 v${plan.versionNo}${plan.isDraft ? " (초안 — 결재 전)" : " (결재본)"}`, content: maskText(planToText(plan.fields)) }];
    const criteria = criteriaFor(task, lead.code);
    const prev = await db.progressEvaluation.findFirst({ where: { task_id: task.id, deliverable_version_id: { not: v.id } }, orderBy: { created_at: "desc" }, include: { deliverable_version: { select: { version_no: true } } } });
    const out = await callStructured(db, provider, {
      agent: "a6",
      promptVersion: A6_PROMPT_VERSION,
      schema: a6Schema,
      jobId: aiJobId,
      budgetKrw: await getNumberSetting(db, termId, "AI_DAILY_BUDGET_KRW", 30000),
      usdKrw: Number(process.env.USD_KRW ?? 1400),
      maxTokens: 8000,
      system: A6_SYSTEM,
      documents,
      images,
      prompt: a6Prompt({
        task: { title: task.title, description: task.description, department: DEPT_KO[lead.code] ?? lead.name_ko, due_date: task.due_date ? dateColumnToString(task.due_date) : null },
        criteria: criteria.list,
        criteriaSource: criteria.source,
        project: task.project
          ? { title: task.project.title, event_start: task.project.event_start ? dateColumnToString(task.project.event_start) : null, venue: task.project.venue, funding: task.project.funding_sources.map((f) => (f.source === "school" ? "교비" : "학생회비")) }
          : null,
        deliverable: { title: v.deliverable.title, version_no: v.version_no, file_name: v.original_name, note: v.note, kind: images ? "image" : "text" },
        plan: plan ? { versionNo: plan.versionNo, isDraft: plan.isDraft } : null,
        previous: prev ? { version_no: prev.deliverable_version.version_no, score: prev.score, missing_items: (prev.missing_items as string[] | null) ?? [] } : null,
      }),
      mockContext: { criteria: criteria.list, text: v.extracted_text, image: !!images },
    });
    const score = normalizeScore(out);
    const evaluation = await db.progressEvaluation.create({
      data: {
        task_id: task.id,
        deliverable_version_id: v.id,
        score,
        rubric_results: { items: out.criteria, summary: out.summary, ai_score: out.score, criteria_source: criteria.source } as object,
        missing_items: out.missing_items,
        suggestions: out.suggestions,
        model: provider.model,
        prompt_version: A6_PROMPT_VERSION,
      },
    });
    // 이 업무에서 가장 최근에 올라온 버전인가
    const newest = await db.deliverableVersion.findFirst({
      where: { deleted_at: null, deliverable: { task_id: task.id, deleted_at: null } },
      orderBy: { created_at: "desc" },
      select: { id: true },
    });
    const applied = newest?.id === v.id;
    if (applied) await setAiProgress(db, termId, task.id, score, evaluation.id);
    await db.aiJob.update({ where: { id: aiJobId }, data: { status: "succeeded", finished_at: new Date() } });
    await db.notification.create({
      data: {
        user_id: v.uploaded_by,
        type: "deliverable_evaluated",
        title: `AI 평가 완료: ${task.title} ${score}%`,
        body: out.missing_items.length ? `부족 항목: ${out.missing_items.slice(0, 3).join(", ")}` : "부족 항목 없음",
        link: `/departments/${lead.code}?task=${task.id}&tab=deliverables`,
        dedupe_key: `evaluated:${evaluation.id}`,
      },
    });
    return { outcome: "succeeded", score, applied };
  } catch (e) {
    if (e instanceof AiBudgetExceededError) {
      await db.aiJob.update({ where: { id: aiJobId }, data: { status: "waiting_budget", error: "budget_exceeded" } });
      return { outcome: "waiting_budget" };
    }
    if (e instanceof AiUnavailableError) return fail(`ai_unavailable: ${e.message}`);
    if (e instanceof AiOutputInvalidError) return fail(`output_invalid: ${e.message.slice(0, 300)}`);
    if (job.attempts >= MAX_AI_ATTEMPTS) return fail(`transient_exhausted: ${(e as Error).message?.slice(0, 300)}`);
    await db.aiJob.update({ where: { id: aiJobId }, data: { status: "queued", error: (e as Error).message?.slice(0, 300) ?? "error" } });
    throw e instanceof AiTransientError ? e : new AiTransientError((e as Error).message ?? "error");
  }
}
