import "server-only";
import { ForbiddenError } from "@/lib/auth/can";
import { ServiceError } from "@/lib/services/invitations";

/** API 공통 오류 응답 — 내부 오류 내용은 노출하지 않는다 */
export function errorResponse(e: unknown): Response {
  if (e instanceof ForbiddenError) return Response.json({ error: "권한이 없습니다." }, { status: 403 });
  if (e instanceof ServiceError) return Response.json({ error: e.message }, { status: e.status });
  console.error("[api] 처리 중 오류:", e instanceof Error ? e.message : e);
  return Response.json({ error: "처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." }, { status: 500 });
}

export function unauthorized(): Response {
  return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
}
