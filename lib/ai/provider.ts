import type { Env } from "@/lib/env";
import { isDeployedEnv } from "@/lib/env";

/**
 * LLM 공급자 추상화 (지시서 3-2, 6-1, ADR-010/021).
 * Phase 1: 인터페이스 + mock + none. 실제 Anthropic 구현은 Phase 5 에서 추가한다.
 */
export type CompleteRequest = {
  agent: string;
  system: string;
  /** 회의록·작업물 등 '데이터' 블록. 지시문으로 취급하지 않는다. */
  documents?: string[];
  prompt: string;
  /** mock 공급자가 고를 픽스처 키 */
  fixtureKey?: string;
};

export type CompleteResult = { text: string; model: string; inputTokens: number; outputTokens: number };

export interface AiProvider {
  readonly name: "anthropic" | "mock" | "none";
  readonly available: boolean;
  complete(req: CompleteRequest): Promise<CompleteResult>;
}

export class AiUnavailableError extends Error {
  constructor(message = "AI 일시 사용 불가") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export type MockFixtures = Record<string, string>;

export class MockProvider implements AiProvider {
  readonly name = "mock" as const;
  readonly available = true;
  constructor(private readonly fixtures: MockFixtures = {}) {}
  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const key = req.fixtureKey ?? req.agent;
    const text = this.fixtures[key];
    if (text === undefined) throw new Error(`mock 픽스처 없음: ${key}`);
    return { text, model: "mock", inputTokens: 0, outputTokens: 0 };
  }
}

export class NoneProvider implements AiProvider {
  readonly name = "none" as const;
  readonly available = false;
  async complete(): Promise<CompleteResult> {
    throw new AiUnavailableError();
  }
}

/**
 * 지시서 3-4: mock 공급자가 staging·production 에서 활성화되면 시작을 거부한다.
 * anthropic 인데 키가 없으면 none 으로 동작(수동 기능은 정상 — T25).
 */
export function assertAiConfig(e: Pick<Env, "APP_ENV" | "AI_PROVIDER">): void {
  if (e.AI_PROVIDER === "mock" && isDeployedEnv(e.APP_ENV)) {
    throw new Error(`AI_PROVIDER=mock 은 ${e.APP_ENV} 환경에서 사용할 수 없습니다. anthropic 또는 none 으로 설정하세요.`);
  }
}

export function resolveAiMode(e: Pick<Env, "AI_PROVIDER" | "ANTHROPIC_API_KEY">): "anthropic" | "mock" | "none" {
  if (e.AI_PROVIDER === "anthropic") return e.ANTHROPIC_API_KEY ? "anthropic" : "none";
  return e.AI_PROVIDER;
}

export function createProvider(e: Pick<Env, "APP_ENV" | "AI_PROVIDER" | "ANTHROPIC_API_KEY">, fixtures?: MockFixtures): AiProvider {
  assertAiConfig(e);
  const mode = resolveAiMode(e);
  if (mode === "mock") return new MockProvider(fixtures);
  // anthropic 구현은 Phase 5 — 그 전까지는 키가 있어도 사용 불가로 표시
  return new NoneProvider();
}
