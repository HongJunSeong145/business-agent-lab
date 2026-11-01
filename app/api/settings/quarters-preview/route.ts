import { readJson, withUser } from "@/lib/api";
import { previewQuarters } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return withUser(async () => Response.json(previewQuarters(await readJson(req))));
}
