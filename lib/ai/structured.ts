import { z } from "zod";
import type { Db } from "@/lib/db";
import { todayKst } from "@/lib/clock";
import type { AiProvider, CompleteRequest } from "./provider";

/**
 * 구조화 호출 (6-1): 스키마 검증 실패 시 오류 메시지를 붙여 1회 재요청, 그래도 실패면 AiOutputInvalidError.
 * 모든 호출은 ai_runs 에 기록(토큰·지연·비용). 일일 예산 초과 시 호출하지 않는다(6-4).
 */
export class AiOutputInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiOutputInvalidError";
  }
}

export class AiBudgetExceededError extends Error {
  constructor(readonly spentKrw: number, readonly budgetKrw: number) {
    super(`오늘 AI 예산(${budgetKrw.toLocaleString()}원)을 모두 썼습니다.`);
    this.name = "AiBudgetExceededError";
  }
}

export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const s = z.toJSONSchema(schema) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

/** 오늘(KST) 사용한 AI 비용(원) */
export async function spentTodayKrw(db: Db): Promise<number> {
  const today = todayKst();
  const start = new Date(`${today}T00:00:00+09:00`);
  const r = await db.aiRun.aggregate({ _sum: { cost_estimate_krw: true }, where: { created_at: { gte: start } } });
  return Number(r._sum.cost_estimate_krw ?? 0);
}

export async function assertBudget(db: Db, budgetKrw: number): Promise<void> {
  const spent = await spentTodayKrw(db);
  if (budgetKrw > 0 && spent >= budgetKrw) throw new AiBudgetExceededError(spent, budgetKrw);
}

export async function callStructured<T>(
  db: Db,
  provider: AiProvider,
  opts: {
    agent: string;
    promptVersion: string;
    schema: z.ZodType<T>;
    jobId: string | null;
    budgetKrw: number;
    usdKrw: number;
  } & Omit<CompleteRequest, "schema" | "agent">,
): Promise<T> {
  await assertBudget(db, opts.budgetKrw);
  const jsonSchema = jsonSchemaOf(opts.schema);
  let prompt = opts.prompt;
  let lastIssues = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    const res = await provider.complete({ agent: opts.agent, system: opts.system, documents: opts.documents, prompt, schema: jsonSchema, maxTokens: opts.maxTokens, mockContext: opts.mockContext });
    const parsed = opts.schema.safeParse(res.json);
    await db.aiRun.create({
      data: {
        job_id: opts.jobId,
        agent: opts.agent,
        model: res.model,
        prompt_version: opts.promptVersion,
        input_tokens: res.inputTokens,
        output_tokens: res.outputTokens,
        latency_ms: Date.now() - started,
        cost_estimate_krw: res.costUsd !== null ? Math.round(res.costUsd * opts.usdKrw * 100) / 100 : null,
        output_valid: parsed.success,
      },
    });
    if (parsed.success) return parsed.data;
    lastIssues = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    prompt = `${opts.prompt}\n\n[이전 제출이 스키마 검증에 실패했다] ${lastIssues}\n스키마에 정확히 맞춰 submit_result 로 다시 제출하라.`;
  }
  throw new AiOutputInvalidError(`AI 출력이 형식에 맞지 않습니다(${lastIssues}).`);
}
