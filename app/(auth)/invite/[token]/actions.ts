"use server";

import { prisma } from "@/lib/db";
import { acceptInvitation, ServiceError } from "@/lib/services/invitations";
import { signIn } from "@/auth";

export type AcceptState = { error?: string; displayName?: string };

export async function acceptInviteAction(token: string, _prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const password = String(formData.get("password") ?? "");
  let email: string;
  try {
    const r = await acceptInvitation(prisma, token, {
      displayName: formData.get("displayName"),
      password,
      passwordConfirm: formData.get("passwordConfirm"),
    });
    email = r.email;
  } catch (e) {
    if (e instanceof ServiceError) return { error: e.message, displayName: String(formData.get("displayName") ?? "") };
    throw e;
  }
  await signIn("credentials", { email, password, redirectTo: "/" });
  return {};
}
