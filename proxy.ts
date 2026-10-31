import { NextResponse, type NextRequest } from "next/server";

/**
 * 사이트 전체 로그인 필수 (D12, 10-3). 여기서는 세션 쿠키 존재만 보고 빠르게 리다이렉트하고,
 * 실제 검증(JWT 서명·만료·session_version·계정 상태)은 서버 렌더링 단계(lib/auth/session.ts)에서 한다.
 */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((n) => request.cookies.has(n));
  if (hasSession) return NextResponse.next();
  // API 는 리다이렉트 대신 401
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api/auth|api/health|login|invite|_next/static|_next/image|favicon.ico|fonts/).*)"],
};
