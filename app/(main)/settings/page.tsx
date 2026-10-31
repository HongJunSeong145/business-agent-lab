import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/can";
import { Card, CardTitle } from "@/components/ui/card";
import { ComingSoon } from "@/components/common/empty-state";

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">설정</h1>
      <Card className="space-y-3">
        <CardTitle>계정</CardTitle>
        <Link href="/settings/account" className="block text-sm underline">내 계정 · 비밀번호 변경</Link>
      </Card>
      {can(user, { type: "members.manage" }) ? (
        <Card className="space-y-3">
          <CardTitle>회원</CardTitle>
          <Link href="/settings/members" className="block text-sm underline">회원·초대 관리</Link>
        </Card>
      ) : null}
      {can(user, { type: "settings.manage" }) ? (
        <Card className="space-y-3">
          <CardTitle>학생회 운영</CardTitle>
          <Link href="/settings/term" className="block text-sm underline">기수·분기 설정 (학사일정으로 분기 자동 계산, 배너 문구)</Link>
          <Link href="/settings/rules" className="block text-sm underline">규칙 파라미터·휴일</Link>
          <div className="flex flex-wrap gap-2">
            <ComingSoon phase={8} label="배너 사진" />
            <ComingSoon phase={5} label="AI 사용량" />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
