import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { withUser } from "@/lib/api";
import { addReference, listReferences } from "@/lib/services/references";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => Response.json(await listReferences(prisma, u, (await params).id)));
}

/** 링크·파일 추가 — multipart: url | file, title, note */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => {
    const form = await req.formData();
    const str = (k: string) => (typeof form.get(k) === "string" && String(form.get(k)).trim() ? String(form.get(k)) : undefined);
    const file = form.get("file");
    const item = await addReference(prisma, getStorage(), u, (await params).id, {
      url: str("url"),
      title: str("title"),
      note: str("note"),
      file: file instanceof File && file.size > 0 ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : undefined,
    });
    return Response.json({ id: item.id }, { status: 201 });
  });
}
