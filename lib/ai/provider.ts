import type { Env } from "@/lib/env";
import { isDeployedEnv } from "@/lib/env";
import { AnthropicProvider, ANTHROPIC_DEFAULT_MODEL } from "@/lib/ai/anthropic";

/**
 * LLM 공급자 추상화 (지시서 3-2·6-1, ADR-010·021·026).
 *  - anthropic: Claude API 직접 호출(lib/ai/anthropic.ts). 키는 ANTHROPIC_API_KEY 에만 둔다.
 *  - openrouter: OpenRouter(OpenAI 호환 Chat Completions)로 Claude 등 모델 호출. 키는 환경변수 OPENROUTER_API_KEY 에만 둔다.
 *  - mock: 결정적 응답(테스트·개발). staging/production 에서는 시작 거부.
 *  - none: AI 끔 — 수동 기능만(T25)
 * 구조화 출력: 함수 호출(tool) 1개를 강제해 JSON 을 받고, 항상 zod 로 다시 검증한다(lib/ai/structured.ts).
 */
export type JsonSchema = Record<string, unknown>;

export type CompleteRequest = {
  agent: string;
  system: string;
  /** 회의록·작업물 등 '데이터' — 지시문으로 취급하지 않는다 */
  documents?: { name: string; content: string }[];
  prompt: string;
  schema: JsonSchema;
  maxTokens?: number;
  /** 이미지(작업물 평가 A6 등) — 지원하는 공급자만 사용 */
  images?: { mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; base64: string }[];
  /** mock 공급자 전용 입력(실제 공급자는 무시) */
  mockContext?: unknown;
};

export type CompleteResult = {
  /** 함수 호출 인자(JSON) 또는 본문에서 찾은 JSON */
  json: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

export type SearchRequest = { agent: string; system: string; prompt: string; maxUses?: number; mockContext?: unknown };
export type SearchSource = { url: string; title: string; page_age?: string | null };
export type SearchResult = {
  /** 모델이 검색 후 정리한 메모(자유 형식) */
  text: string;
  /** 실제 검색 결과로 받은 출처 — 레퍼런스 링크는 이 안에 있는 것만 인정한다 */
  sources: SearchSource[];
  searches: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

/** 웹 검색을 쓸 수 없는 공급자·설정 — A5 는 내부 자료만으로 예시안을 만들고 "외부 레퍼런스 검색 실패"를 표시한다 */
export class AiSearchUnavailableError extends Error {
  constructor(message = "웹 검색을 사용할 수 없습니다") {
    super(message);
    this.name = "AiSearchUnavailableError";
  }
}

export interface AiProvider {
  readonly name: "anthropic" | "openrouter" | "mock" | "none";
  readonly available: boolean;
  readonly model: string;
  complete(req: CompleteRequest): Promise<CompleteResult>;
  /** 서버 측 웹 검색 (지원하지 않으면 없음) */
  search?(req: SearchRequest): Promise<SearchResult>;
}

export class AiUnavailableError extends Error {
  constructor(message = "AI 일시 사용 불가") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/** 일시 오류(429·5xx·네트워크) — 큐가 재시도한다 */
export class AiTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiTransientError";
  }
}

export function wrapDocuments(docs: { name: string; content: string }[] = []): string {
  return docs.map((d) => `<document name="${d.name}" kind="data">\n${d.content}\n</document>`).join("\n\n");
}

/** 본문에 섞인 JSON 을 꺼낸다(함수 호출을 안 쓰는 모델 대비) */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const candidate = fenced ?? text.slice(Math.max(0, text.indexOf("{")), text.lastIndexOf("}") + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

type FetchLike = typeof fetch;

export class OpenRouterProvider implements AiProvider {
  readonly name = "openrouter" as const;
  readonly available = true;
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly opts: { referer?: string; fetchImpl?: FetchLike; timeoutMs?: number } = {},
  ) {}

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const user = [wrapDocuments(req.documents), req.prompt].filter(Boolean).join("\n\n");
    const body = {
      model: this.model,
      temperature: 0,
      max_tokens: req.maxTokens ?? 8000,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: user },
      ],
      tools: [{ type: "function", function: { name: "submit_result", description: "결과를 스키마에 맞춰 제출", parameters: req.schema } }],
      tool_choice: { type: "function", function: { name: "submit_result" } },
      usage: { include: true },
    };
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "KGB_Agent",
          ...(this.opts.referer ? { "HTTP-Referer": this.opts.referer } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 180_000),
      });
    } catch (e) {
      throw new AiTransientError(`AI 서버에 연결하지 못했습니다: ${(e as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) throw new AiUnavailableError("AI 키가 올바르지 않거나 권한이 없습니다.");
    if (res.status === 402) throw new AiUnavailableError("AI 사용 크레딧이 부족합니다.");
    if (res.status === 429 || res.status >= 500) throw new AiTransientError(`AI 서버 일시 오류(${res.status})`);
    if (!res.ok) throw new AiUnavailableError(`AI 요청 실패(${res.status})`);
    const data = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string | null; tool_calls?: { function?: { arguments?: string } }[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      error?: { message?: string };
    };
    if (data.error) throw new AiTransientError(`AI 응답 오류: ${data.error.message ?? "알 수 없음"}`);
    const msg = data.choices?.[0]?.message;
    const args = msg?.tool_calls?.[0]?.function?.arguments;
    let json: unknown = null;
    if (args) {
      try {
        json = JSON.parse(args);
      } catch {
        json = null;
      }
    }
    if (json === null && msg?.content) json = extractJson(msg.content);
    return {
      json,
      model: data.model ?? this.model,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      costUsd: typeof data.usage?.cost === "number" ? data.usage.cost : null,
    };
  }
}

export type MockHandler = (req: CompleteRequest) => unknown;
export type MockSearchHandler = (req: SearchRequest) => Omit<SearchResult, "model" | "inputTokens" | "outputTokens" | "costUsd">;

/** 결정적 mock — 에이전트별 처리 함수(lib/ai/mock.ts) */
export class MockProvider implements AiProvider {
  readonly name = "mock" as const;
  readonly available = true;
  readonly model = "mock";
  constructor(
    private readonly handlers: Record<string, MockHandler> = {},
    private readonly searchHandlers: Record<string, MockSearchHandler> = {},
  ) {}
  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const h = this.handlers[req.agent];
    if (!h) throw new Error(`mock 처리 함수 없음: ${req.agent}`);
    return { json: h(req), model: "mock", inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }
  async search(req: SearchRequest): Promise<SearchResult> {
    const h = this.searchHandlers[req.agent];
    if (!h) throw new AiSearchUnavailableError("mock 검색 처리 함수 없음");
    return { ...h(req), model: "mock", inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }
}

export class NoneProvider implements AiProvider {
  readonly name = "none" as const;
  readonly available = false;
  readonly model = "none";
  async complete(): Promise<CompleteResult> {
    throw new AiUnavailableError();
  }
}

/** 지시서 3-4: mock 이 staging·production 에서 켜지면 시작 거부 */
export function assertAiConfig(e: Pick<Env, "APP_ENV" | "AI_PROVIDER">): void {
  if (e.AI_PROVIDER === "mock" && isDeployedEnv(e.APP_ENV)) {
    throw new Error(`AI_PROVIDER=mock 은 ${e.APP_ENV} 환경에서 사용할 수 없습니다. anthropic·openrouter 또는 none 으로 설정하세요.`);
  }
}

/** 키가 없으면 none 으로 동작(T25) */
export function resolveAiMode(
  e: Pick<Env, "AI_PROVIDER" | "OPENROUTER_API_KEY" | "ANTHROPIC_API_KEY">,
): "anthropic" | "openrouter" | "mock" | "none" {
  if (e.AI_PROVIDER === "anthropic") return e.ANTHROPIC_API_KEY ? "anthropic" : "none";
  if (e.AI_PROVIDER === "openrouter") return e.OPENROUTER_API_KEY ? "openrouter" : "none";
  return e.AI_PROVIDER;
}

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

export function createProvider(
  e: Pick<Env, "APP_ENV" | "AI_PROVIDER" | "OPENROUTER_API_KEY" | "ANTHROPIC_API_KEY" | "LLM_MODEL">,
  mockHandlers?: Record<string, MockHandler>,
  opts?: { referer?: string; fetchImpl?: FetchLike; mockSearch?: Record<string, MockSearchHandler> },
): AiProvider {
  assertAiConfig(e);
  const mode = resolveAiMode(e);
  if (mode === "mock") return new MockProvider(mockHandlers, opts?.mockSearch);
  if (mode === "anthropic") return new AnthropicProvider(e.ANTHROPIC_API_KEY!, e.LLM_MODEL || ANTHROPIC_DEFAULT_MODEL);
  if (mode === "openrouter") return new OpenRouterProvider(e.OPENROUTER_API_KEY!, e.LLM_MODEL || DEFAULT_MODEL, opts);
  return new NoneProvider();
}
