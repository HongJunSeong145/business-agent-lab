import { createHash } from "node:crypto";
import type { Db } from "@/lib/db";

/** 지시서 10-3: 로그인 시도 제한 5회/15분 (계정 기준 + IP 기준) */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** 개인정보 최소화: 이메일은 해시로만 저장 (ADR-018) */
export function hashEmail(email: string): string {
  return createHash("sha256").update(`kgb-login:${email.trim().toLowerCase()}`).digest("hex");
}

export async function isLoginBlocked(db: Db, email: string, ip: string | null, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const [byEmail, byIp] = await Promise.all([
    db.loginAttempt.count({ where: { email_hash: hashEmail(email), success: false, created_at: { gte: since } } }),
    ip
      ? db.loginAttempt.count({ where: { ip, success: false, created_at: { gte: since } } })
      : Promise.resolve(0),
  ]);
  // IP 기준은 여러 계정을 겨냥한 시도를 막기 위해 계정 기준의 4배까지 허용
  return byEmail >= LOGIN_MAX_FAILURES || byIp >= LOGIN_MAX_FAILURES * 4;
}

export async function recordLoginAttempt(db: Db, email: string, ip: string | null, success: boolean): Promise<void> {
  await db.loginAttempt.create({ data: { email_hash: hashEmail(email), ip, success } });
}

export function clientIpFromHeaders(headers: Headers | undefined | null): string | null {
  if (!headers) return null;
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || null;
  return headers.get("x-real-ip");
}
