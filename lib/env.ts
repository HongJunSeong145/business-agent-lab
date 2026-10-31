import { z } from "zod";

/** 실행 환경 구분 (지시서 3-4) */
export const APP_ENVS = ["development", "test", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const schema = z.object({
  APP_ENV: z.enum(APP_ENVS).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL 필요"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET 은 32자 이상"),
  AI_PROVIDER: z.enum(["anthropic", "openrouter", "mock", "none"]).default("none"),
  OPENROUTER_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  /** AI 비용 원화 환산 (OpenRouter 는 USD 로 비용을 알려준다) */
  USD_KRW: z.coerce.number().positive().default(1400),
  WORKER_MODE: z.enum(["inline", "separate", "off"]).default("inline"),
  STORAGE_DRIVER: z.enum(["local", "db", "s3"]).default("db"),
  UPLOAD_MAX_MB: z.coerce.number().int().positive().default(50),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const r = schema.safeParse(source);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`환경변수 설정 오류 — ${msg}`);
  }
  return r.data;
}

let cached: Env | null = null;
export function env(): Env {
  cached ??= parseEnv();
  return cached;
}

export function isDeployedEnv(e: AppEnv): boolean {
  return e === "staging" || e === "production";
}
