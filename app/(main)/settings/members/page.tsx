import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can, ROLE_LABEL, type Role } from "@/lib/auth/can";
import { Card, CardTitle } from "@/components/ui/card";
import { DemoBadge } from "@/components/common/badges";
import { Button } from "@/components/ui/button";
import { InviteForm } from "./invite-form";
import { revokeInviteAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const user = await requireUser();
  if (!can(user, { type: "members.manage" })) notFound();

  const [departments, memberships, invitations] = await Promise.all([
    prisma.department.findMany({ where: { term_id: user.termId }, orderBy: { display_order: "asc" } }),
    prisma.membership.findMany({
      where: { term_id: user.termId },
      include: { user: true, department: true },
      orderBy: [{ department: { display_order: "asc" } }, { created_at: "asc" }],
    }),
    prisma.invitation.findMany({
      where: { term_id: user.termId, accepted_at: null, revoked_at: null, expires_at: { gt: new Date() } },
      include: { department: true },
      orderBy: { created_at: "desc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-xl font-semibold">회원·초대 관리</h1>

      <Card>
        <CardTitle className="mb-4">새 회원 초대</CardTitle>
        <InviteForm departments={departments.map((d) => ({ id: d.id, name: d.name_ko }))} allowAdmin={user.role === "admin"} />
      </Card>

      <Card>
        <CardTitle className="mb-3">대기 중인 초대 ({invitations.length})</CardTitle>
        {invitations.length === 0 ? (
          <p className="text-sm text-muted">대기 중인 초대가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-border">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {i.email} · {ROLE_LABEL[i.role as Role]}
                  {i.department ? ` · ${i.department.name_ko}` : ""}
                  <span className="ml-2 text-xs text-muted">만료 {i.expires_at.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</span>
                </span>
                <form action={revokeInviteAction}>
                  <input type="hidden" name="id" value={i.id} />
                  <Button type="submit" size="sm" variant="secondary">취소</Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle className="mb-3">회원 ({memberships.length})</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr><th className="px-2 py-2 font-medium">이름</th><th className="px-2 py-2 font-medium">역할</th><th className="px-2 py-2 font-medium">국서</th><th className="px-2 py-2 font-medium">상태</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {memberships.map((m) => (
                <tr key={m.id}>
                  <td className="px-2 py-2">{m.user.display_name}{m.is_demo ? <DemoBadge className="ml-1" /> : null}</td>
                  <td className="px-2 py-2">{ROLE_LABEL[m.role as Role]}</td>
                  <td className="px-2 py-2">{m.department?.name_ko ?? "-"}</td>
                  <td className="px-2 py-2">{m.user.status === "active" ? "활성" : m.user.status === "invited" ? "초대됨(미가입)" : "비활성"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
