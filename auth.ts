/**
 * Auth.js v5 — Credentials + JWT 세션 (ADR-004, 사용자 결정 N2)
 *  - 유휴 7일 만료: maxAge 7일 + updateAge 1일(슬라이딩)
 *  - 전체 세션 무효화: users.session_version 을 토큰에 담고 매 요청 DB 값과 비교(lib/auth/session.ts)
 *  - 로그인 시도 제한: 5회/15분 (lib/auth/rate-limit.ts)
 */
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { burnPasswordCheck, verifyPassword } from "@/lib/auth/password";
import { clientIpFromHeaders, isLoginBlocked, recordLoginAttempt } from "@/lib/auth/rate-limit";

export class RateLimitedError extends CredentialsSignin {
  code = "rate_limited";
}
export class InvalidCredentialsError extends CredentialsSignin {
  code = "invalid_credentials";
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

export const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SEC, updateAge: 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: { label: "이메일" }, password: { label: "비밀번호", type: "password" } },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) throw new InvalidCredentialsError();
        const { email, password } = parsed.data;
        const ip = clientIpFromHeaders(request?.headers);

        if (await isLoginBlocked(prisma, email, ip)) throw new RateLimitedError();

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.password_hash || user.status !== "active") {
          await burnPasswordCheck(password);
          await recordLoginAttempt(prisma, email, ip, false);
          throw new InvalidCredentialsError();
        }
        const ok = await verifyPassword(user.password_hash, password);
        await recordLoginAttempt(prisma, email, ip, ok);
        if (!ok) throw new InvalidCredentialsError();

        await prisma.$transaction([
          prisma.user.update({ where: { id: user.id }, data: { last_login_at: new Date() } }),
          prisma.activityLog.create({
            data: { actor_id: user.id, actor_kind: "user", action: "auth.login", entity_type: "user", entity_id: user.id, ip },
          }),
        ]);
        return { id: user.id, name: user.display_name, sessionVersion: user.session_version };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.sv = (user as { sessionVersion?: number }).sessionVersion ?? 0;
      }
      return token;
    },
    session({ session, token }) {
      return {
        ...session,
        uid: typeof token.uid === "string" ? token.uid : undefined,
        sv: typeof token.sv === "number" ? token.sv : undefined,
      };
    },
  },
});
