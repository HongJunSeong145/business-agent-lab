"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/can";
import { createInvitation, revokeInvitation, ServiceError } from "@/lib/services/invitations";

export type InviteState = { error?: string; link?: string; email?: string; draftEmail?: string };

async function baseUrl(): Promise<string> {
  const configured = process.env.AUTH_URL ?? process.env.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export async function createInviteAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const user = await requireUser();
  const dept = String(formData.get("departmentId") ?? "");
  try {
    const { invitation, token } = await createInvitation(prisma, user, {
      email: formData.get("email"),
      role: formData.get("role"),
      departmentId: dept || null,
    });
    revalidatePath("/settings/members");
    return { link: `${await baseUrl()}/invite/${token}`, email: invitation.email };
  } catch (e) {
    if (e instanceof ServiceError || e instanceof ForbiddenError) return { error: e.message, draftEmail: String(formData.get("email") ?? "") };
    throw e;
  }
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await revokeInvitation(prisma, user, String(formData.get("id")));
  revalidatePath("/settings/members");
}
