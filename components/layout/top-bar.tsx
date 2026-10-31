import Link from "next/link";
import { Upload } from "lucide-react";
import { GlobalSearch, NotificationBell } from "./search-bell";
import { getPermissionSettings } from "@/lib/settings";
import { UploadMinutesDialog } from "@/components/minutes/upload-dialog";
import { prisma } from "@/lib/db";
import { can, isLeader, ROLE_LABEL } from "@/lib/auth/can";
import type { SessionUser } from "@/lib/auth/session";
import { UserMenu } from "./user-menu";
import { MainNav } from "./main-nav";
import { aiAvailable } from "@/lib/ai/runtime";

/** 상단 고정 바 (8-1) */
export async function TopBar({ user }: { user: SessionUser }) {
  const [unread, pending, settings] = await Promise.all([
    prisma.notification.count({ where: { user_id: user.userId, read_at: null } }),
    isLeader(user) ? prisma.proposal.count({ where: { term_id: user.termId, status: "pending" } }) : Promise.resolve(0),
    getPermissionSettings(prisma, user.termId),
  ]);
  const subtitle = [user.departmentName, user.positionTitle ?? ROLE_LABEL[user.role]].filter(Boolean).join(" · ");

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4">
        <Link href="/" className="shrink-0 text-base font-bold tracking-tight">
          KGB_Agent
        </Link>

        <MainNav />

        <GlobalSearch />

        <div className="ml-auto flex items-center gap-1.5">
          {!aiAvailable() ? (
            <span className="hidden rounded-lg border border-dashed border-border px-2.5 py-1 text-xs text-muted sm:inline" data-testid="ai-off" title="AI 키가 없거나 꺼져 있습니다. 수동 기능은 정상입니다.">
              AI 일시 사용 불가
            </span>
          ) : null}
          {isLeader(user) ? (
            <Link href="/review" className={`hidden rounded-lg border px-2.5 py-1 text-xs sm:inline ${pending ? "border-info bg-[#EEF3F8] text-info" : "border-border text-muted"}`}>
              검토 대기 <strong className="tabular">{pending}</strong>
            </Link>
          ) : null}
          {can(user, { type: "meeting.upload" }, settings) ? (
            <UploadMinutesDialog
              maxMb={Number(process.env.UPLOAD_MAX_MB ?? 50)}
              trigger={
                <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-text px-3 text-sm font-medium text-white hover:bg-[#33383f]">
                  <Upload className="h-4 w-4" /> <span className="hidden sm:inline">회의록 업로드</span>
                </button>
              }
            />
          ) : null}
          <NotificationBell unread={unread} />
          <UserMenu name={user.displayName} subtitle={subtitle} canManageMembers={can(user, { type: "members.manage" })} />
        </div>
      </div>
    </header>
  );
}
