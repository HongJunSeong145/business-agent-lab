import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** 비밀값 유출 방지 (0-5 ⑩): 저장소에 추적되는 파일에 API 키·비밀번호 원문이 없어야 한다 */
const PATTERNS: [string, RegExp][] = [
  ["OpenRouter 키", /sk-or-v1-[0-9a-f]{20,}/],
  ["Anthropic 키", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI 키", /sk-(proj-)?[A-Za-z0-9]{32,}/],
  ["개인 키", /-----BEGIN (RSA |EC )?PRIVATE KEY-----/],
];

describe("저장소 비밀값 검사", () => {
  const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
  it(".env.local 등 환경 파일은 추적하지 않는다(.env.example 만 허용)", () => {
    expect(files.filter((f) => /(^|\/)\.env(\..+)?$/.test(f) && !f.endsWith(".env.example"))).toEqual([]);
  });
  it("추적 파일에 키 형식 문자열이 없다", () => {
    const hits: string[] = [];
    for (const f of files) {
      if (/\.(png|jpe?g|pdf|hwp|hwpx|docx|woff2?|ico)$/i.test(f)) continue;
      let text: string;
      try {
        text = readFileSync(f, "utf8");
      } catch {
        continue;
      }
      for (const [name, re] of PATTERNS) if (re.test(text)) hits.push(`${f}: ${name}`);
    }
    expect(hits).toEqual([]);
  });
  it(".env.example 에는 키 값이 비어 있다", () => {
    const ex = readFileSync(".env.example", "utf8");
    for (const k of ["OPENROUTER_API_KEY", "AUTH_SECRET", "FILE_URL_SECRET", "INITIAL_ADMIN_PASSWORD"]) {
      expect(ex).toMatch(new RegExp(`^${k}=\\s*$`, "m"));
    }
  });
  it("API 키를 브라우저 번들로 내보내는 NEXT_PUBLIC_ 변수가 없다", () => {
    const src = execSync("git grep -l NEXT_PUBLIC_ -- '*.ts' '*.tsx' || true", { encoding: "utf8" }).trim();
    expect(src).toBe("");
  });
});
