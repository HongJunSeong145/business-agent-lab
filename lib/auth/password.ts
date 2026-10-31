import { hash, verify } from "@node-rs/argon2";

export const PASSWORD_MIN_LENGTH = 10;

// argon2id (기본 알고리즘) — OWASP 권장 수준 파라미터
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function validatePasswordPolicy(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`;
  if (password.length > 200) return "비밀번호가 너무 깁니다.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** 타이밍 공격 완화용: 존재하지 않는 계정에도 같은 비용의 검증을 수행 */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  await verifyPassword(await dummyHash, password);
}
