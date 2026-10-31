import { describe, expect, it } from "vitest";
import { maskDeep, maskText } from "@/lib/audit/mask";
import { assertAiConfig, createProvider, MockProvider, NoneProvider, resolveAiMode, AiUnavailableError } from "@/lib/ai/provider";
import { parseEnv } from "@/lib/env";
import { validatePasswordPolicy, hashPassword, verifyPassword } from "@/lib/auth/password";
import { hashEmail, clientIpFromHeaders } from "@/lib/auth/rate-limit";
import { dDayLabel, formatKoreanDate, kstDateString } from "@/lib/utils";
import { defaultTermDates } from "@/lib/setup/defaults";

describe("개인정보 마스킹 (0-5 ⑪)", () => {
  it("값 패턴: 이메일·휴대전화·학번", () => {
    expect(maskText("연락 010-1234-5678, a.b@ex.com, 학번 2023123456")).toBe("연락 ***, ***, 학번 ***");
  });
  it("키 이름 기준 + 중첩 구조", () => {
    expect(maskDeep({ name: "홍길동", phone: "아무값", nested: [{ gmail: "x" }], note: "메일 x@y.kr" })).toEqual({
      name: "홍길동", phone: "***", nested: [{ gmail: "***" }], note: "메일 ***",
    });
    expect(maskDeep({ phone: null })).toEqual({ phone: null });
    expect(maskDeep(3)).toBe(3);
  });
});

describe("AI 공급자 설정 (3-4, ADR-021)", () => {
  it("staging·production 에서 mock 이면 시작 거부", () => {
    expect(() => assertAiConfig({ APP_ENV: "staging", AI_PROVIDER: "mock" })).toThrow(/mock/);
    expect(() => assertAiConfig({ APP_ENV: "production", AI_PROVIDER: "mock" })).toThrow(/mock/);
    expect(() => assertAiConfig({ APP_ENV: "development", AI_PROVIDER: "mock" })).not.toThrow();
    expect(() => assertAiConfig({ APP_ENV: "staging", AI_PROVIDER: "none" })).not.toThrow();
  });
  it("anthropic 인데 키 없으면 none (T25)", () => {
    expect(resolveAiMode({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: undefined })).toBe("none");
    expect(resolveAiMode({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" })).toBe("anthropic");
  });
  it("none 공급자는 AI 사용 불가 오류", async () => {
    const p = createProvider({ APP_ENV: "staging", AI_PROVIDER: "none" });
    expect(p).toBeInstanceOf(NoneProvider);
    expect(p.available).toBe(false);
    await expect(p.complete()).rejects.toBeInstanceOf(AiUnavailableError);
  });
  it("mock 공급자는 픽스처로 결정적 응답", async () => {
    const p = createProvider({ APP_ENV: "test", AI_PROVIDER: "mock" }, { a1: '{"ok":true}' });
    expect(p).toBeInstanceOf(MockProvider);
    expect((await p.complete({ agent: "a1", system: "", prompt: "" })).text).toBe('{"ok":true}');
    await expect(p.complete({ agent: "x", system: "", prompt: "" })).rejects.toThrow(/픽스처 없음/);
  });
});

describe("환경변수", () => {
  it("필수값 누락 시 명확한 오류", () => {
    expect(() => parseEnv({ DATABASE_URL: "x" })).toThrow(/AUTH_SECRET/);
  });
  it("기본값", () => {
    const e = parseEnv({ DATABASE_URL: "x", AUTH_SECRET: "a".repeat(32) });
    expect(e).toMatchObject({ APP_ENV: "development", AI_PROVIDER: "none", WORKER_MODE: "inline", STORAGE_DRIVER: "db", UPLOAD_MAX_MB: 50 });
  });
});

describe("비밀번호", () => {
  it("최소 10자 (10-3)", () => {
    expect(validatePasswordPolicy("123456789")).toMatch(/10자/);
    expect(validatePasswordPolicy("1234567890")).toBeNull();
    expect(validatePasswordPolicy("x".repeat(201))).toMatch(/너무 깁니다/);
  });
  it("argon2id 해시·검증", async () => {
    const h = await hashPassword("correct-horse-battery");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "correct-horse-battery")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});

describe("로그인 제한 헬퍼", () => {
  it("이메일은 정규화 후 해시(원문 저장 안 함)", () => {
    expect(hashEmail(" A@B.com ")).toBe(hashEmail("a@b.com"));
    expect(hashEmail("a@b.com")).not.toContain("a@b.com");
  });
  it("IP 추출", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIpFromHeaders(new Headers())).toBeNull();
    expect(clientIpFromHeaders(null)).toBeNull();
  });
});

describe("날짜 유틸 (Asia/Seoul)", () => {
  it("KST 기준 날짜: UTC 15:00 이후는 다음 날", () => {
    expect(kstDateString(new Date("2026-10-31T14:59:00Z"))).toBe("2026-10-31");
    expect(kstDateString(new Date("2026-10-31T15:00:00Z"))).toBe("2026-11-01");
  });
  it("D-n", () => {
    expect(dDayLabel("2026-12-10", "2026-10-31")).toBe("D-40");
    expect(dDayLabel("2026-10-31", "2026-10-31")).toBe("D-day");
    expect(dDayLabel("2026-10-30", "2026-10-31")).toBe("D+1");
  });
  it("한국어 날짜", () => expect(formatKoreanDate("2026-12-10")).toBe("12월 10일(목)"));
  it("기본 기수 날짜: 오늘이 포함되고 분기가 이어짐", () => {
    const d = defaultTermDates(new Date("2026-10-31T00:00:00Z"));
    expect(d.start_date.toISOString().slice(0, 10)).toBe("2025-12-01");
    expect(d.q4_end.toISOString().slice(0, 10)).toBe("2026-11-30");
    const dec = defaultTermDates(new Date("2026-12-05T00:00:00Z"));
    expect(dec.start_date.toISOString().slice(0, 10)).toBe("2026-12-01");
  });
});
