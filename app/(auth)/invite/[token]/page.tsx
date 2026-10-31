import Link from "next/link";
import { prisma } from "@/lib/db";
import { lookupInvitation } from "@/lib/services/invitations";
import { ROLE_LABEL, type Role } from "@/lib/auth/can";
import { AcceptForm } from "./accept-form";

export const dynamic = "force-dynamic";

const REASON: Record<string, string> = {
  not_found: "유효하지 않은 초대 링크입니다.",
  expired: "초대 링크가 만료되었습니다(72시간). 관리자에게 새 링크를 요청하세요.",
  used: "이미 사용된 초대 링크입니다. 로그인해 주세요.",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await lookupInvitation(prisma, token);
  if (!r.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold">초대 확인</h1>
        <p className="text-sm text-danger" role="alert">{REASON[r.reason]}</p>
        <Link href="/login" className="text-sm underline">로그인 화면으로</Link>
      </div>
    );
  }
  const inv = r.invitation;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">학생회 초대</h1>
      <p className="mb-4 text-sm text-muted">
        {inv.departmentName ? `${inv.departmentName} · ` : ""}
        {ROLE_LABEL[inv.role as Role]}(으)로 초대되었습니다.
      </p>
      <AcceptForm token={token} email={inv.email} />
    </>
  );
}
