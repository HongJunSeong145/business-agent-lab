"use server";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { changePassword, ServiceError } from "@/lib/services/invitations";
import { signOut } from "@/auth";

export type PwState = { error?: string };

export async function changePasswordAction(_prev: PwState, formData: FormData): Promise<PwState> {
  const user = await requireUser();
  try {
    await changePassword(prisma, user.userId, {
      current: formData.get("current"),
      next: formData.get("next"),
      confirm: formData.get("confirm"),
    }, verifyPassword);
  } catch (e) {
    if (e instanceof ServiceError) return { error: e.message };
    throw e;
  }
  // 모든 세션이 무효화되었으므로 다시 로그인
  await signOut({ redirectTo: "/login" });
  return {};
}
