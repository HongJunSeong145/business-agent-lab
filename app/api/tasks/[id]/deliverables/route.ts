import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { withUser } from "@/lib/api";
import { dispatchJob } from "@/lib/jobs/queue";
import { listDeliverables, uploadDeliverable } from "@/lib/services/deliverables";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 작업물 탭 데이터 (모든 구성원 열람) */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => Response.json(await listDeliverables(prisma, u, (await params).id)));
}

/** 작업물 업로드 — multipart/form-data: file | externalUrl, deliverableId(새 버전), title, note */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (u) => {
    const maxMb = Number(process.env.UPLOAD_MAX_MB ?? 50);
    if (Number(req.headers.get("content-length") ?? 0) > (maxMb + 1) * 1024 * 1024) return Response.json({ error: `파일이 너무 큽니다(최대 ${maxMb}MB).` }, { status: 413 });
    const form = await req.formData();
    const file = form.get("file");
    const str = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" && v.trim() ? v : undefined;
    };
    const r = await uploadDeliverable(prisma, getStorage(), u, {
      taskId: (await params).id,
      deliverableId: str("deliverableId"),
      appendToLatest: str("target") === "latest",
      title: str("title"),
      note: str("note"),
      externalUrl: str("externalUrl"),
      file: file instanceof File && file.size > 0 ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : undefined,
    });
    if (r.aiJobId) await dispatchJob(r.aiJobId, "evaluate_deliverable");
    return Response.json(r, { status: 201 });
  });
}
