import { withUser } from "@/lib/api";
import { loadCalendar } from "@/lib/calendar";

export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}/;

export async function GET(req: Request) {
  return withUser(async (u) => {
    const url = new URL(req.url);
    const from = url.searchParams.get("start")?.match(DAY)?.[0];
    const to = url.searchParams.get("end")?.match(DAY)?.[0];
    if (!from || !to || from > to) return Response.json({ error: "기간을 지정하세요." }, { status: 400 });
    return Response.json(await loadCalendar(u, from, to), { headers: { "Cache-Control": "no-store" } });
  });
}
