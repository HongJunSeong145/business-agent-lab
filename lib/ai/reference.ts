import type { Db } from "@/lib/db";
import { maskText } from "@/lib/audit/mask";
import { dateColumnToString } from "@/lib/utils";
import { getNumberSetting } from "@/lib/settings";
import { meetingForTask, pastWorkForTask } from "@/lib/services/references";
import { planForContext, planToText } from "@/lib/services/plans";
import { AiSearchUnavailableError, AiTransientError, AiUnavailableError, type AiProvider, type SearchResult } from "./provider";
import { AiBudgetExceededError, AiOutputInvalidError, assertBudget, callStructured } from "./structured";
import { a5Schema } from "./schemas/a5";
import { A5_PROMPT_VERSION, A5_SEARCH_SYSTEM, A5_SYSTEM, a5Prompt, a5SearchPrompt } from "./prompts/a5";
import { criteriaFor } from "./a6-criteria";
import { sanitizeMarkup } from "./sanitize";
import { MAX_AI_ATTEMPTS, type AiJobOutcome } from "./agents";

/**
 * A5 레퍼런스 조사·예시안 (6-2 A5, D11, T19).
 *  1) 웹 검색(서버 측 도구) → 실제 출처 목록
 *  2) 구조화 출력: 출처 번호로 레퍼런스 선별·요약 + 국서 형식 예시안
 *  3) 코드가 출처 번호를 실제 URL 로 바꿔 저장(목록 밖 번호는 버림), HTML/SVG 는 정리 후 저장
 * 검색이 안 되면 내부 자료만으로 예시안을 만들고 "외부 레퍼런스 검색 실패"를 남긴다.
 */
const DEPT_KO: Record<string, string> = { planning: "기획국", finance: "재정국", secretariat: "사무국", promotion: "홍보국", operations: "집행국" };

export async function runReferenceJob(db: Db, provider: AiProvider, aiJobId: string): Promise<{ outcome: AiJobOutcome; items?: number; searchFailed?: boolean }> {
  const claimed = await db.aiJob.updateMany({ where: { id: aiJobId, type: "reference", status: "queued" }, data: { status: "running", started_at: new Date(), attempts: { increment: 1 }, error: null } });
  if (claimed.count !== 1) return { outcome: "skipped" };
  const job = await db.aiJob.findUniqueOrThrow({ where: { id: aiJobId } });
  const { requestId } = job.payload as { requestId: string };
  const req = await db.referenceRequest.findUnique({
    where: { id: requestId },
    include: { task: { include: { departments: { include: { department: true } }, project: { include: { funding_sources: true } } } } },
  });
  const fail = async (error: string, userMessage: string) => {
    await db.$transaction([
      db.aiJob.update({ where: { id: aiJobId }, data: { status: "failed", error, finished_at: new Date() } }),
      db.referenceRequest.update({ where: { id: requestId }, data: { status: "failed", error: userMessage } }),
    ]);
    if (req) {
      await db.notification.create({ data: { user_id: req.requested_by, type: "reference_failed", title: `레퍼런스 제작 실패: ${req.task.title}`, body: userMessage, severity: "warn", link: `/departments/${req.task.departments.find((d) => d.role === "lead")?.department.code ?? "planning"}?task=${req.task_id}&tab=references`, dedupe_key: `ref-fail:${requestId}:${job.attempts}` } }).catch(() => undefined);
    }
    return { outcome: "failed" as const };
  };
  if (!req || req.task.deleted_at) return fail("task_missing", "업무를 찾을 수 없습니다.");
  const task = req.task;
  const lead = task.departments.find((d) => d.role === "lead")!.department;
  const termId = lead.term_id;
  await db.referenceRequest.update({ where: { id: requestId }, data: { status: "running" } });
  const snapshot = (req.context_snapshot ?? {}) as { options?: { useMinutes?: boolean; usePlan?: boolean; usePastWork?: boolean } } & Record<string, unknown>;
  const opts = snapshot.options ?? {};
  const budgetKrw = await getNumberSetting(db, termId, "AI_DAILY_BUDGET_KRW", 10000);
  const usdKrw = Number(process.env.USD_KRW ?? 1400);

  try {
    const meeting = opts.useMinutes !== false ? await meetingForTask(db, task) : null;
    const plan = opts.usePlan !== false && task.project_id ? await planForContext(db, task.project_id) : null;
    const past = opts.usePastWork ? await pastWorkForTask(db, task) : [];
    const project = task.project
      ? {
          title: task.project.title,
          event_start: task.project.event_start ? dateColumnToString(task.project.event_start) : null,
          venue: task.project.venue,
          funding: task.project.funding_sources.map((f) => (f.source === "school" ? "교비" : "학생회비")),
          beneficiaries: task.project.expected_beneficiaries,
        }
      : null;
    const taskInfo = {
      title: task.title, description: task.description, department: DEPT_KO[lead.code] ?? lead.name_ko, deptCode: lead.code,
      due_date: task.due_date ? dateColumnToString(task.due_date) : null, criteria: criteriaFor(task, lead.code).list,
    };

    // 1) 웹 검색
    let search: SearchResult | null = null;
    let searchError: string | null = null;
    if (!provider.search) searchError = "이 AI 설정은 웹 검색을 지원하지 않습니다";
    else {
      await assertBudget(db, budgetKrw);
      const started = Date.now();
      try {
        search = await provider.search({ agent: "a5_search", system: A5_SEARCH_SYSTEM, prompt: a5SearchPrompt({ task: taskInfo, project, instruction: req.instruction }), maxUses: 5, mockContext: { task: taskInfo } });
      } catch (e) {
        if (e instanceof AiUnavailableError) throw e;
        if (e instanceof AiSearchUnavailableError || e instanceof AiTransientError) searchError = e.message;
        else throw e;
      }
      await db.aiRun.create({
        data: {
          job_id: aiJobId, agent: "a5_search", model: search?.model ?? provider.model, prompt_version: A5_PROMPT_VERSION,
          input_tokens: search?.inputTokens ?? 0, output_tokens: search?.outputTokens ?? 0, latency_ms: Date.now() - started,
          cost_estimate_krw: search?.costUsd != null ? Math.round(search.costUsd * usdKrw * 100) / 100 : null, output_valid: !!search,
        },
      });
    }
    const sources = (search?.sources ?? []).slice(0, 20);

    // 2) 정리·예시안
    const documents: { name: string; content: string }[] = [];
    if (search) documents.push({ name: "검색 결과", content: `${sources.map((s, i) => `S${i + 1}. ${s.title} — ${s.url}`).join("\n")}\n\n[조사 메모]\n${search.text.slice(0, 20000)}` });
    if (plan) documents.push({ name: `기획안 v${plan.versionNo}${plan.isDraft ? " (초안)" : " (결재본)"}`, content: maskText(planToText(plan.fields)) });
    if (meeting) documents.push({ name: `회의록 분석: ${meeting.title}`, content: maskText(JSON.stringify(meeting.summary).slice(0, 20000)) });
    for (const p of past) documents.push({ name: `과거 작업물: ${p.taskTitle} — ${p.deliverableTitle}`, content: maskText(p.text) });

    const out = await callStructured(db, provider, {
      agent: "a5",
      promptVersion: A5_PROMPT_VERSION,
      schema: a5Schema,
      jobId: aiJobId,
      budgetKrw,
      usdKrw,
      maxTokens: 16000,
      system: A5_SYSTEM,
      documents,
      prompt: a5Prompt({ task: taskInfo, project, instruction: req.instruction, plan: plan ? { versionNo: plan.versionNo, isDraft: plan.isDraft } : null, hasMeeting: !!meeting, pastWorkCount: past.length, searchFailed: !search, sourceCount: sources.length }),
      mockContext: { task: taskInfo, sources, searchFailed: !search, plan },
    });

    // 3) 저장: 출처 번호 → 실제 URL (목록 밖 번호·중복은 버림)
    const seen = new Set<string>();
    const refs = out.references.flatMap((r) => {
      const s = sources[Number(r.source_id.slice(1)) - 1];
      if (!s || seen.has(s.url)) return [];
      seen.add(s.url);
      return [{ ...r, url: s.url, title: s.title }];
    });
    const searchFailed = !search;
    const n = await db.$transaction(async (tx) => {
      for (const r of refs) {
        await tx.referenceItem.create({
          data: { task_id: task.id, project_id: task.project_id, department_id: lead.id, kind: "link", title: r.title.slice(0, 200) || r.url, url: r.url, summary: r.summary, points: r.benchmark_points, relevance_note: r.relevance, origin: "ai_search", request_id: requestId },
        });
      }
      for (const ex of out.examples) {
        await tx.referenceItem.create({
          data: {
            task_id: task.id, project_id: task.project_id, department_id: lead.id, kind: "ai_example", title: ex.title, summary: ex.kind || null,
            content: ex.format === "markdown" ? ex.content : sanitizeMarkup(ex.content), content_format: ex.format, origin: "ai_generated",
            request_id: requestId, needs_review_before_send: ex.external_send,
          },
        });
      }
      if (out.plan_draft) {
        const d = out.plan_draft;
        const md = [`# ${d.title || "레퍼런스 기획안"}`, `- 행사 날짜: ${d.event_date ?? "[ ]"}`, `- 일시: ${d.datetime || "[ ]"}`, `- 장소: ${d.venue || "[ ]"}`, `- 예산: ${d.budget === null ? "[ ]" : `${d.budget.toLocaleString()}원`}`, `- 주최: ${d.host || "[ ]"} / 주관: ${d.organizer || "[ ]"}`, "", "## 배경 및 목적", d.purpose, "", "## 행사 내용", d.content, "", "## 타임테이블", ...d.timetable.map((t) => `- ${t.time} ${t.item}`)].join("\n");
        await tx.referenceItem.create({
          data: { task_id: task.id, project_id: task.project_id, department_id: lead.id, kind: "ai_example", title: "AI 레퍼런스 기획안(양식으로 가져오기 가능)", summary: "기획안 초안", content: md, content_format: "markdown", points: { plan: d } as object, origin: "ai_generated", request_id: requestId },
        });
      }
      await tx.referenceRequest.update({
        where: { id: requestId },
        data: {
          status: "done",
          error: null,
          context_snapshot: {
            ...snapshot,
            meeting: meeting ? { meetingId: meeting.meetingId, title: meeting.title, analysisId: meeting.analysisId, analysisVersion: meeting.analysisVersion } : null,
            plan: plan ? { versionId: plan.versionId, versionNo: plan.versionNo, isDraft: plan.isDraft } : null,
            pastWork: past.map((p) => ({ versionId: p.versionId, title: `${p.taskTitle} — ${p.deliverableTitle}` })),
            searchFailed,
            searchNote: searchFailed ? `외부 레퍼런스 검색 실패${searchError ? ` (${searchError})` : ""}` : `웹 검색 ${search!.searches}회, 출처 ${sources.length}개 중 ${refs.length}개 선별`,
            notes: out.notes,
            model: provider.model,
            promptVersion: A5_PROMPT_VERSION,
          } as object,
        },
      });
      await tx.aiJob.update({ where: { id: aiJobId }, data: { status: "succeeded", finished_at: new Date() } });
      await tx.notification.create({
        data: {
          user_id: req.requested_by, type: "reference_done", title: `레퍼런스 제작 완료: ${task.title}`,
          body: `레퍼런스 ${refs.length}건 · 예시안 ${out.examples.length}건${searchFailed ? " · 외부 레퍼런스 검색 실패" : ""}`,
          link: `/departments/${lead.code}?task=${task.id}&tab=references`, dedupe_key: `ref-done:${requestId}`,
        },
      });
      return refs.length + out.examples.length;
    });
    return { outcome: "succeeded", items: n, searchFailed };
  } catch (e) {
    if (e instanceof AiBudgetExceededError) {
      await db.aiJob.update({ where: { id: aiJobId }, data: { status: "waiting_budget", error: "budget_exceeded" } });
      await db.referenceRequest.update({ where: { id: requestId }, data: { status: "queued", error: "오늘 AI 예산을 모두 써서 내일 이어서 만듭니다." } });
      return { outcome: "waiting_budget" };
    }
    if (e instanceof AiUnavailableError) return fail(`ai_unavailable: ${e.message}`, "AI 연결 문제로 만들지 못했습니다. 잠시 후 다시 의뢰하세요.");
    if (e instanceof AiOutputInvalidError) return fail(`output_invalid: ${e.message.slice(0, 300)}`, "AI 결과 형식 오류로 만들지 못했습니다. 다시 의뢰하세요.");
    if (job.attempts >= MAX_AI_ATTEMPTS) return fail(`transient_exhausted: ${(e as Error).message?.slice(0, 300)}`, "일시적인 오류로 만들지 못했습니다. 다시 의뢰하세요.");
    await db.aiJob.update({ where: { id: aiJobId }, data: { status: "queued", error: (e as Error).message?.slice(0, 300) ?? "error" } });
    await db.referenceRequest.update({ where: { id: requestId }, data: { status: "queued" } });
    throw e instanceof AiTransientError ? e : new AiTransientError((e as Error).message ?? "error");
  }
}
