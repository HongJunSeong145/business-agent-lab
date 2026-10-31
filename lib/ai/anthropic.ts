import Anthropic from "@anthropic-ai/sdk";
import { AiTransientError, AiUnavailableError, wrapDocuments, extractJson } from "@/lib/ai/provider";
import type { AiProvider, CompleteRequest, CompleteResult } from "@/lib/ai/provider";

/**
 * Anthropic(Claude API) 공급자 (ADR-028).
 *  - 공식 SDK 사용. 키는 환경변수 ANTHROPIC_API_KEY 에만 둔다(코드·저장소·로그에 남기지 않음).
 *  - 구조화 출력: output_config.format(json_schema)로 스키마에 맞는 JSON 을 받고, zod 로 다시 검증한다.
 *  - 거절(stop_reason=refusal) 대비: 서버측 대체 모델(fallbacks: "default") 사용.
 *  - baseURL 을 명시한다(실행 환경의 ANTHROPIC_BASE_URL 에 끌려가지 않도록).
 */
export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5";

/** 1M 토큰당 USD (입력, 출력) — 200K 이하 프롬프트 기준 */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export function anthropicCostUsd(model: string, inTok: number, outTok: number): number | null {
  const key = Object.keys(PRICES).find((k) => model.startsWith(k));
  if (!key) return null;
  const [pi, po] = PRICES[key]!;
  return (inTok * pi + outTok * po) / 1_000_000;
}

const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"]);

/** JSON Schema 를 구조화 출력이 받는 형태로 정리: 모든 object 에 additionalProperties:false, 미지원 키워드 제거 */
export function toStrictSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toStrictSchema);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (["$schema", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems", "pattern", "format"].includes(k)) continue;
    out[k] = toStrictSchema(v);
  }
  if (out.type === "object" || out.properties) {
    out.additionalProperties = false;
  }
  return out;
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;
  readonly available = true;
  private readonly client: Anthropic;
  constructor(
    apiKey: string,
    readonly model: string,
    opts: { timeoutMs?: number; client?: Anthropic } = {},
  ) {
    this.client =
      opts.client ??
      new Anthropic({ apiKey, baseURL: "https://api.anthropic.com", timeout: opts.timeoutMs ?? 300_000, maxRetries: 1 });
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const text = [wrapDocuments(req.documents), req.prompt].filter(Boolean).join("\n\n");
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      ...(req.images ?? []).map(
        (img): Anthropic.Beta.BetaContentBlockParam => ({
          type: "image",
          source: { type: "base64", media_type: img.mediaType, data: img.base64 },
        }),
      ),
      { type: "text", text },
    ];
    const useFallback = FALLBACK_MODELS.has(this.model);
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages: [{ role: "user", content }],
        output_config: { format: { type: "json_schema", schema: toStrictSchema(req.schema) as Record<string, unknown> } },
        ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
    } catch (e) {
      throw mapError(e);
    }
    const inputTokens = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    const outputTokens = res.usage.output_tokens;
    const base = { model: res.model, inputTokens, outputTokens, costUsd: anthropicCostUsd(res.model, inputTokens, outputTokens) };
    if (res.stop_reason === "refusal") {
      // 결과 없음 → 검증 실패로 처리되어 재시도/실패 표시(사용자에게 '수동 처리' 안내)
      return { json: null, ...base };
    }
    const out = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    let json: unknown = null;
    try {
      json = JSON.parse(out);
    } catch {
      json = extractJson(out);
    }
    return { json, ...base };
  }
}

function mapError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new AiUnavailableError("AI 키가 올바르지 않거나 권한이 없습니다.");
  }
  if (e instanceof Anthropic.RateLimitError) return new AiTransientError("AI 요청 한도 초과(429)");
  if (e instanceof Anthropic.InternalServerError) return new AiTransientError(`AI 서버 일시 오류(${e.status})`);
  if (e instanceof Anthropic.APIConnectionError) return new AiTransientError(`AI 서버에 연결하지 못했습니다: ${e.message}`);
  if (e instanceof Anthropic.BadRequestError) {
    const msg = e.message ?? "";
    if (/credit|billing/i.test(msg)) return new AiUnavailableError("AI 사용 크레딧이 부족합니다.");
    return new AiUnavailableError(`AI 요청 형식 오류(400): ${msg.slice(0, 200)}`);
  }
  if (e instanceof Anthropic.APIError) return new AiUnavailableError(`AI 요청 실패(${e.status ?? "?"})`);
  return e instanceof Error ? e : new Error(String(e));
}
