import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { withUser } from "@/lib/api";
import { uploadEvidence } from "@/lib/services/finance";
import { ServiceError } from "@/lib/services/invitations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** 증빙 업로드 — multipart: file, requirementId | purchaseItemId, note */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ServiceError("파일을 고르세요.");
    const str = (k: string) => (typeof form.get(k) === "string" && String(form.get(k)) ? String(form.get(k)) : null);
    const e = await uploadEvidence(prisma, getStorage(), u, (await params).id, {
      requirementId: str("requirementId"), purchaseItemId: str("purchaseItemId"), note: str("note"),
      file: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
    });
    return Response.json({ id: e.id }, { status: 201 });
  });
}
