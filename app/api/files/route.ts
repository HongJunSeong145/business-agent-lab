import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { getStorage, isValidStorageKey } from "@/lib/storage";
import { verifySignature } from "@/lib/storage/signed-url";
import { unauthorized } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 파일 다운로드 (10-3): 로그인 + 서명 URL(10분) + 소유 기수 확인을 모두 통과해야 한다.
 * 브라우저에서 바로 실행되지 않도록 nosniff + sandbox CSP, PDF·텍스트 외에는 항상 첨부파일로 내려준다.
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

  // 현재는 회의록 원본만 존재. 이후 작업물·증빙이 생기면 소유 확인 대상을 추가한다.
  const owner = await prisma.meetingFile.findFirst({
    where: { storage_key: key, meeting: { term_id: user.termId, deleted_at: null } },
    select: { original_name: true, mime: true },
  });
  if (!owner) return Response.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  const data = await getStorage().get(key);
  if (!data) return Response.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });

  const mime = owner.mime ?? "application/octet-stream";
  const inline = url.searchParams.get("dl") !== "1" && (mime === "application/pdf" || mime.startsWith("text/"));
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
