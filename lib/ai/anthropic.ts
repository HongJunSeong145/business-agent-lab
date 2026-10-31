import Anthropic from "@anthropic-ai/sdk";
import { AiSearchUnavailableError, AiTransientError, AiUnavailableError, wrapDocuments, extractJson } from "@/lib/ai/provider";
import type { AiProvider, CompleteRequest, CompleteResult, SearchRequest, SearchResult, SearchSource } from "@/lib/ai/provider";

/**
 * Anthropic(Claude API) 공급자 (ADR-028).
 *  - 공식 SDK 사용. 키는 환경변수 ANTHROPIC_API_KEY 에만 둔다(코드·저장소·로그에 남기지 않음).
 *  - 구조화 출력: output_config.format(json_schema)로 스키마에 맞는 JSON 을 받고, zod 로 다시 검증한다.
 *  - 거절(stop_reason=refusal) 대비: 서버측 대체 모델(fallbacks: "default") 사용.
 *  - baseURL 을 명시한다(실행 환경의 ANTHROPIC_BASE_URL 에 끌려가지 않도록).
 */
export const ANTHROPIC_DEFAULT_MODEL = "claude-fable-5-1";

/**
 * 생각 깊이(effort). 사용자 결정(2026-10-31): 비용이 더 들어도 사고력·추천력이 높은 모델(Fable 5.1)과 깊은 사고(high).
 * 하루 점검 문장(a7)처럼 단순한 일은 low. 환경변수 LLM_EFFORT 로 바꿀 수 있다(low·medium·high·xhigh·max).
 */
type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export function effortFor(agent: string, env = process.env.LLM_EFFORT): Effort {
  if (agent === "a7") return "low";
  return (["low", "medium", "high", "xhigh", "max"] as const).find((e) => e === env) ?? "high";
}
/** 계정에서 기본 모델(Fable 5.1)을 쓸 수 없을 때(없는 모델·데이터 보존 정책 등) 한 번만 바꿔 시도할 모델 */
export const ANTHROPIC_BACKUP_MODEL = "claude-opus-5-5";
function modelUnavailable(e: unknown): boolean {
  if (e instanceof Anthropic.NotFoundError) return true;
  if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.PermissionDeniedError) return /model|retention|zero data|zdr|not available|access/i.test(e.message ?? "");
  return false;
}

/** 생각(thinking) 토큰도 출력 한도에 포함되므로 넉넉히 — 비용은 실제 쓴 만큼만 든다 */
const MIN_MAX_TOKENS = 32000;

/** 1M 토큰당 USD (입력, 출력) — 200K 이하 프롬프트 기준 */
const PRICES: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-fable-5": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

/** 웹 검색 단가: 1,000회당 $10 */
export const WEB_SEARCH_USD = 0.01;

export function anthropicCostUsd(model: string, inTok: number, outTok: number): number | null {
  const key = Object.keys(PRICES).find((k) => model.startsWith(k));
  if (!key) return null;
  const [pi, po] = PRICES[key]!;
  return (inTok * pi + outTok * po) / 1_000_000;
}

const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"]);

/** JSON Schema 를 구조화 출력이 받는 형태로 정리: 모든 object 에 additionalProperties:false, 미지원 키워드 제거 */
const DROP_KEYWORDS = new Set(["$schema", "default", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems", "pattern", "format"]);

export function toStrictSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toStrictSchema);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (DROP_KEYWORDS.has(k)) continue;
    if ((k === "properties" || k === "$defs" || k === "definitions") && v && typeof v === "object" && !Array.isArray(v)) {
      // 속성 이름(예: "format")은 키워드가 아니므로 그대로 두고 값만 정리
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([name, sub]) => [name, toStrictSchema(sub)]));
      continue;
    }
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
    public model: string,
    opts: { timeoutMs?: number; client?: Anthropic } = {},
  ) {
    this.client =
      opts.client ??
      new Anthropic({ apiKey, baseURL: "https://api.anthropic.com", timeout: opts.timeoutMs ?? 900_000, maxRetries: 1 });
  }

  /** 기본 모델을 계정에서 못 쓰면 예비 모델로 바꿔 한 번 더(이후 요청도 예비 모델) */
  private async withBackup<T>(fn: (model: string) => Promise<T>): Promise<T> {
    try {
      return await fn(this.model);
    } catch (e) {
      if (this.model === ANTHROPIC_BACKUP_MODEL || !modelUnavailable(e)) throw e;
      this.model = ANTHROPIC_BACKUP_MODEL;
      return fn(this.model);
    }
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
      // 긴 생각·출력도 끊기지 않게 스트리밍으로 받고 최종 메시지만 쓴다
      res = await this.withBackup((model) => this.client.beta.messages
        .stream({
          model,
          max_tokens: Math.max(req.maxTokens ?? 16000, MIN_MAX_TOKENS),
          system: req.system,
          messages: [{ role: "user", content }],
          output_config: { effort: effortFor(req.agent), format: { type: "json_schema", schema: toStrictSchema(req.schema) as Record<string, unknown> } },
          ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        })
        .finalMessage());
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

  /**
   * 서버 측 웹 검색(web_search). 결과 출처(URL·제목)는 web_search_tool_result 블록에서만 모은다.
   * 긴 검색은 stop_reason=pause_turn 으로 끊길 수 있어 그대로 이어 보낸다(최대 3회).
   */
  async search(req: SearchRequest): Promise<SearchResult> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: req.prompt }];
    const sources = new Map<string, SearchSource>();
    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let searches = 0;
    let model = this.model;
    let errors = 0;
    for (let turn = 0; turn < 4; turn++) {
      let res: Anthropic.Beta.BetaMessage;
      try {
        res = await this.withBackup((m) => this.client.beta.messages
          .stream({
            model: m,
            max_tokens: MIN_MAX_TOKENS,
            system: req.system,
            messages,
            output_config: { effort: effortFor(req.agent) },
            tools: [{ type: "web_search_20260209", name: "web_search", max_uses: req.maxUses ?? 5, allowed_callers: ["direct"] }],
          })
          .finalMessage());
      } catch (e) {
        throw mapError(e);
      }
      model = res.model;
      inputTokens += res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
      outputTokens += res.usage.output_tokens;
      searches += res.usage.server_tool_use?.web_search_requests ?? 0;
      for (const b of res.content) {
        if (b.type === "web_search_tool_result") {
          if (Array.isArray(b.content)) for (const r of b.content) sources.set(r.url, { url: r.url, title: r.title, page_age: r.page_age });
          else errors++;
        } else if (b.type === "text") {
          text += b.text;
        }
      }
      if (res.stop_reason === "refusal") break;
      if (res.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
    }
    if (sources.size === 0) throw new AiSearchUnavailableError(errors ? "웹 검색 오류" : "검색 결과 없음");
    const cost = anthropicCostUsd(model, inputTokens, outputTokens);
    return { text, sources: [...sources.values()], searches, model, inputTokens, outputTokens, costUsd: cost === null ? null : cost + searches * WEB_SEARCH_USD };
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
