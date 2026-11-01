import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { withUser } from "@/lib/api";
import { updateBanner } from "@/lib/services/directory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 배너 편집 — multipart: title, subtitle, image(선택), removeImage=1 */
export async function POST(req: Request) {
  return withUser(async (u) => {
    const form = await req.formData();
    const img = form.get("image");
    await updateBanner(
      prisma, getStorage(), u,
      { title: String(form.get("title") ?? ""), subtitle: String(form.get("subtitle") ?? "") },
      img instanceof File && img.size > 0 ? { name: img.name, bytes: new Uint8Array(await img.arrayBuffer()) } : null,
      form.get("removeImage") === "1",
    );
    return Response.json({ ok: true });
  });
}
