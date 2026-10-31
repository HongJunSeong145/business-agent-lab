import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { Actor, Role } from "./can";

export type SessionUser = Actor & {
  displayName: string;
  email: string;
  termId: string;
  departmentName: string | null;
  positionTitle: string | null;
};

/**
 * 현재 요청의 사용자. JWT 만 믿지 않고 매 요청 DB 를 확인한다:
 *  - 계정이 active 가 아니거나, session_version 이 토큰과 다르면(비밀번호 변경 등) 로그아웃 상태로 본다.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const s = session as unknown as { uid?: string; sv?: number } | null;
  if (!s?.uid) return null;
  const user = await prisma.user.findUnique({
    where: { id: s.uid },
    include: {
      memberships: {
        where: { term: { is_current: true } },
        include: { department: true },
        take: 1,
      },
    },
  });
  if (!user || user.status !== "active" || user.session_version !== (s.sv ?? -1)) return null;
  const m = user.memberships[0];
  if (!m) return null;
  return {
    userId: user.id,
    role: m.role as Role,
    departmentId: m.department_id,
    departmentCode: m.department?.code ?? null,
    departmentName: m.department?.name_ko ?? null,
    positionTitle: m.position_title,
    displayName: user.display_name,
    email: user.email,
    termId: m.term_id,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  return u;
}
