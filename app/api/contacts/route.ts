import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { listContacts } from "@/lib/services/directory";

export const dynamic = "force-dynamic";
export async function GET() {
  return withUser(async (u) => Response.json(await listContacts(prisma, u)));
}
