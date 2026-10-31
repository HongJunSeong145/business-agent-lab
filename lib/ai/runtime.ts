import { env } from "@/lib/env";
import { createProvider, type AiProvider } from "./provider";
import { MOCK_HANDLERS, MOCK_SEARCH_HANDLERS } from "./mock";

/** 현재 설정의 AI 공급자 (요청마다 환경변수를 읽는다 — 키를 넣거나 빼면 바로 반영) */
export function getProvider(): AiProvider {
  const e = env();
  return createProvider(
    { APP_ENV: e.APP_ENV, AI_PROVIDER: e.AI_PROVIDER, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, LLM_MODEL: process.env.LLM_MODEL },
    MOCK_HANDLERS,
    { referer: process.env.AUTH_URL ?? process.env.RENDER_EXTERNAL_URL, mockSearch: MOCK_SEARCH_HANDLERS },
  );
}

export function aiAvailable(): boolean {
  try {
    return getProvider().available;
  } catch {
    return false;
  }
}
