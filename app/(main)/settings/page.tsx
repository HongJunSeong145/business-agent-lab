import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/can";
import { Card, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { AI_DAILY_BUDGET_CAP_KRW, spentTodayKrw } from "@/lib/ai/structured";

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
          <Link href="/" className="block text-sm underline">배너 사진·문구 (대시보드 배너의 「배너 편집」)</Link>
          <p className="text-sm" data-testid="ai-usage">
            오늘 AI 사용액 <strong className="tabular">{Math.round(await spentTodayKrw(prisma)).toLocaleString()}원</strong> / 하루 상한 <span className="tabular">{AI_DAILY_BUDGET_CAP_KRW.toLocaleString()}원</span>
            <span className="block text-xs text-muted">상한을 넘으면 AI 작업은 다음 날까지 대기하고, 수동 기능은 그대로 쓸 수 있습니다.</span>
          </p>
        </Card>
      ) : null}
    </div>
  );
}
