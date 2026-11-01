import { createHmac, timingSafeEqual } from "node:crypto";

/** 파일 다운로드 서명 URL — 10분 만료 (10-3). 로그인 세션 검사와 함께 쓴다. */
export const SIGNED_URL_TTL_SEC = 10 * 60;

function secret(): string {
  const s = process.env.FILE_URL_SECRET || (process.env.AUTH_SECRET ? `${process.env.AUTH_SECRET}:files` : "");
  if (!s) throw new Error("FILE_URL_SECRET 또는 AUTH_SECRET 이 필요합니다.");
  return s;
}

function sign(key: string, exp: number): string {
  return createHmac("sha256", secret()).update(`${key}\n${exp}`).digest("base64url");
}

export function signedFileUrl(key: string, opts: { download?: boolean; now?: number } = {}): string {
  const exp = Math.floor((opts.now ?? Date.now()) / 1000) + SIGNED_URL_TTL_SEC;
  const q = new URLSearchParams({ key, exp: String(exp), sig: sign(key, exp) });
  if (opts.download) q.set("dl", "1");
  return `/api/files?${q.toString()}`;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: "invalid" | "expired" };

export function verifySignature(key: string, expRaw: string | null, sig: string | null, now = Date.now()): SignatureCheck {
  const exp = Number(expRaw);
  if (!sig || !Number.isInteger(exp)) return { ok: false, reason: "invalid" };
  const expected = Buffer.from(sign(key, exp));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" };
  if (exp * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true };
}
