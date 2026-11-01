import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { deleteMeeting } from "@/lib/services/meetings";

export const dynamic = "force-dynamic";

/** 회의록 삭제(소프트) */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => Response.json(await deleteMeeting(prisma, u, (await params).id)));
}
