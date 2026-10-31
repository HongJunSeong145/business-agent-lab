import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";
import { globalSearch } from "@/lib/services/search";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return withUser(async (u) => Response.json({ hits: await globalSearch(prisma, u, new URL(req.url).searchParams.get("q") ?? "") }));
}
