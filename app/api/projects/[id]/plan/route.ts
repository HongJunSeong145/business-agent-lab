import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { withUser } from "@/lib/api";
import { getPlan, savePlanVersion } from "@/lib/services/plans";
import { ServiceError } from "@/lib/services/invitations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => Response.json(await getPlan(prisma, u, (await params).id)));
}

/** 새 버전 저장 — multipart: fields(JSON 문자열), note, file(선택) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => {
    const form = await req.formData();
    let fields: unknown;
    try {
      fields = JSON.parse(String(form.get("fields") ?? "{}"));
    } catch {
      throw new ServiceError("양식 데이터가 올바르지 않습니다.");
    }
    const file = form.get("file");
    const r = await savePlanVersion(prisma, getStorage(), u, (await params).id, {
      fields,
      note: typeof form.get("note") === "string" ? String(form.get("note")) : undefined,
      file: file instanceof File && file.size > 0 ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : undefined,
    });
    return Response.json(r, { status: 201 });
  });
}
