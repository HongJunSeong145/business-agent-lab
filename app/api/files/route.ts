import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { getStorage, isValidStorageKey } from "@/lib/storage";
import { verifySignature } from "@/lib/storage/signed-url";
import { unauthorized } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 파일 다운로드 (10-3): 로그인 + 서명 URL(10분) + 소유 기수 확인을 모두 통과해야 한다.
 * 브라우저에서 바로 실행되지 않도록 nosniff + sandbox CSP, PDF·텍스트·이미지·동영상 외에는 항상 첨부파일로 내려준다.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  if (!isValidStorageKey(key)) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  const check = verifySignature(key, url.searchParams.get("exp"), url.searchParams.get("sig"));
  if (!check.ok) {
    return Response.json(
      { error: check.reason === "expired" ? "링크가 만료되었습니다. 페이지를 새로고침한 뒤 다시 받으세요." : "잘못된 링크입니다." },
      { status: 403 },
    );
  }

  // 소유 확인: 회의록 원본 또는 작업물 버전 — 현재 기수의 것만
  const owner =
    (await prisma.meetingFile.findFirst({
      where: { storage_key: key, meeting: { term_id: user.termId, deleted_at: null } },
      select: { original_name: true, mime: true },
    })) ??
    (await prisma.deliverableVersion.findFirst({
      where: {
        storage_key: key,
        deleted_at: null,
        deliverable: { deleted_at: null, task: { deleted_at: null, departments: { some: { role: "lead", department: { term_id: user.termId } } } } },
      },
      select: { original_name: true, mime: true },
    }));
  if (!owner) return Response.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  const data = await getStorage().get(key);
  if (!data) return Response.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });

  const mime = owner.mime ?? "application/octet-stream";
  // 미리보기 허용 형식(스크립트가 실행될 수 없는 형식만 — SVG·HTML 은 업로드 자체를 받지 않는다)
  const previewable = mime === "application/pdf" || mime.startsWith("text/") || /^image\/(png|jpeg|gif|webp)$/.test(mime) || /^video\/(mp4|quicktime|webm)$/.test(mime);
  const inline = url.searchParams.get("dl") !== "1" && previewable;
  const name = owner.original_name ?? "file";
  return new Response(Buffer.from(data), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(data.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; object-src 'self'",
      "Cache-Control": "private, no-store",
    },
  });
}
