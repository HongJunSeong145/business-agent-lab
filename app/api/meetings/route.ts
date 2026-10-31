import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { getStorage } from "@/lib/storage";
import { createMeeting } from "@/lib/services/meetings";
import { dispatchJob } from "@/lib/jobs/queue";
import { errorResponse, unauthorized } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 회의록 업로드(파일) 또는 붙여넣기(텍스트) — multipart/form-data */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const maxMb = Number(process.env.UPLOAD_MAX_MB ?? 50);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > (maxMb + 1) * 1024 * 1024) return Response.json({ error: `파일이 너무 큽니다(최대 ${maxMb}MB).` }, { status: 413 });

  try {
    const form = await req.formData();
    const meta = {
      title: String(form.get("title") ?? ""),
      meetingDate: String(form.get("meetingDate") ?? ""),
      meetingType: String(form.get("meetingType") ?? "") as "regular",
    };
    const file = form.get("file");
    const text = form.get("text");
    const input =
      file instanceof File && file.size > 0
        ? { ...meta, kind: "file" as const, fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
        : { ...meta, kind: "paste" as const, text: typeof text === "string" ? text : "" };
    const r = await createMeeting(prisma, getStorage(), user, input);
    await dispatchJob(r.aiJobId, "extract");
    return Response.json({ id: r.meetingId }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
