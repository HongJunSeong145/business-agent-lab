import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider, anthropicCostUsd, effortFor, toStrictSchema } from "@/lib/ai/anthropic";
import { AiTransientError, AiUnavailableError, createProvider, resolveAiMode } from "@/lib/ai/provider";

function fakeClient(impl: (body: Record<string, unknown>) => unknown): Anthropic {
  return { beta: { messages: { stream: (b: Record<string, unknown>) => ({ finalMessage: async () => impl(b) }) } } } as unknown as Anthropic;
}
const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const req = { agent: "a1", system: "s", prompt: "p", documents: [{ name: "회의록", content: "x" }], schema: { type: "object", properties: { a: { type: "string", minLength: 1 } } } };

describe("Anthropic 공급자", () => {
  it("키가 없으면 none, 있으면 anthropic", () => {
    expect(resolveAiMode({ AI_PROVIDER: "anthropic", OPENROUTER_API_KEY: undefined, ANTHROPIC_API_KEY: undefined })).toBe("none");
    expect(resolveAiMode({ AI_PROVIDER: "anthropic", OPENROUTER_API_KEY: undefined, ANTHROPIC_API_KEY: "k" })).toBe("anthropic");
    const p = createProvider({ APP_ENV: "staging", AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" });
    expect(p.name).toBe("anthropic");
    expect(p.model).toBe("claude-fable-5-1"); // 사용자 결정 2026-10-31: 두 단계 위 모델
    expect(createProvider({ APP_ENV: "staging", AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", LLM_MODEL: "claude-opus-5-5" }).model).toBe("claude-opus-5-5");
  });
  it("스키마 정리: additionalProperties:false, 미지원 키워드 제거", () => {
    expect(toStrictSchema({ $schema: "x", type: "object", properties: { a: { type: "array", minItems: 1, items: { type: "object", properties: {} } } } })).toEqual({
      type: "object",
      additionalProperties: false,
      properties: { a: { type: "array", items: { type: "object", properties: {}, additionalProperties: false } } },
    });
  });
  it("속성 이름이 키워드와 같아도(format·pattern) 지우지 않는다", () => {
    expect(toStrictSchema({ type: "object", properties: { format: { type: "string", enum: ["a"], format: "uri" }, pattern: { type: "string" } } })).toEqual({
      type: "object",
      additionalProperties: false,
      properties: { format: { type: "string", enum: ["a"] }, pattern: { type: "string" } },
    });
  });
  it("비용 계산", () => {
    expect(anthropicCostUsd("claude-opus-5-5", 1_000_000, 1_000_000)).toBe(24);
    expect(anthropicCostUsd("claude-fable-5-1", 1_000_000, 1_000_000)).toBe(60);
    expect(anthropicCostUsd("unknown", 1, 1)).toBeNull();
  });
  it("JSON 응답·사용량·대체 모델 설정", async () => {
    let sent: Record<string, unknown> = {};
    const p = new AnthropicProvider("k", "claude-opus-5-5", {
      client: fakeClient((b) => {
        sent = b;
        return { model: "claude-opus-5-5", stop_reason: "end_turn", usage, content: [{ type: "text", text: '{"a":"b"}' }] };
      }),
    });
    const r = await p.complete({ ...req, images: [{ mediaType: "image/png", base64: "AAA" }] });
    expect(r.json).toEqual({ a: "b" });
    expect(r.inputTokens).toBe(1000);
    expect(r.costUsd).toBeCloseTo(0.014);
    expect(sent.fallbacks).toBe("default");
    expect(sent).not.toHaveProperty("temperature");
    expect((sent.output_config as { effort: string }).effort).toBe("high"); // 깊은 사고
    expect(sent.max_tokens).toBe(32000); // 생각 토큰 여유
    expect(effortFor("a7")).toBe("low");
    expect(effortFor("a2", "max")).toBe("max");
    expect(effortFor("a2", "이상한값")).toBe("high");
    const msg = (sent.messages as { content: { type: string; text?: string }[] }[])[0]!.content;
    expect(msg[0]!.type).toBe("image");
    expect(msg[1]!.text).toContain('<document name="회의록" kind="data">');
  });
  it("계정에서 기본 모델(Fable 5.1)을 못 쓰면 예비 모델(Opus 5.5)로 한 번 더, 다른 오류는 그대로", async () => {
    const h = new Headers();
    const models: string[] = [];
    const p = new AnthropicProvider("k", "claude-fable-5-1", {
      client: fakeClient((b) => {
        models.push(String(b.model));
        if (b.model === "claude-fable-5-1") throw new Anthropic.NotFoundError(404, {}, "model: claude-fable-5-1 not found", h);
        return { model: String(b.model), stop_reason: "end_turn", usage, content: [{ type: "text", text: '{"a":"b"}' }] };
      }),
    });
    expect((await p.complete(req)).json).toEqual({ a: "b" });
    expect(models).toEqual(["claude-fable-5-1", "claude-opus-5-5"]);
    expect(p.model).toBe("claude-opus-5-5");
    const q = new AnthropicProvider("k", "claude-fable-5-1", { client: fakeClient(() => { throw new Anthropic.RateLimitError(429, {}, "slow", h); }) });
    await expect(q.complete(req)).rejects.toBeInstanceOf(AiTransientError);
    expect(q.model).toBe("claude-fable-5-1");
  });
  it("구조화 출력 스키마에서 default 키워드 제거(속성 이름 default 는 유지)", () => {
    expect(toStrictSchema({ type: "object", properties: { default: { type: "string", default: "x" } } })).toEqual({ type: "object", additionalProperties: false, properties: { default: { type: "string" } } });
  });
  it("거절이면 결과 없음(검증 실패로 처리)", async () => {
    const p = new AnthropicProvider("k", "claude-haiku-5-5", {
      client: fakeClient((b) => {
        expect(b).not.toHaveProperty("fallbacks");
        return { model: "claude-haiku-5-5", stop_reason: "refusal", usage, content: [] };
      }),
    });
    expect((await p.complete(req)).json).toBeNull();
  });
  it("오류 분류: 인증=사용 불가, 429/5xx/연결=일시 오류", async () => {
    const h = new Headers();
    const cases: [unknown, unknown][] = [
      [new Anthropic.AuthenticationError(401, {}, "bad", h), AiUnavailableError],
      [new Anthropic.RateLimitError(429, {}, "slow", h), AiTransientError],
      [new Anthropic.InternalServerError(529, {}, "over", h), AiTransientError],
      [new Anthropic.APIConnectionError({ message: "down" }), AiTransientError],
      [new Anthropic.BadRequestError(400, {}, "credit balance too low", h), AiUnavailableError],
    ];
    for (const [err, cls] of cases) {
      const p = new AnthropicProvider("k", "claude-opus-5-5", { client: fakeClient(() => { throw err; }) });
      await expect(p.complete(req)).rejects.toBeInstanceOf(cls as typeof Error);
    }
  });
});
