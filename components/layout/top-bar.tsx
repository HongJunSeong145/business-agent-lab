import Link from "next/link";
import { Bell, Search, Upload } from "lucide-react";
import { getPermissionSettings } from "@/lib/settings";
import { UploadMinutesDialog } from "@/components/minutes/upload-dialog";
import { prisma } from "@/lib/db";
import { can, isLeader, ROLE_LABEL } from "@/lib/auth/can";
import type { SessionUser } from "@/lib/auth/session";
import { UserMenu } from "./user-menu";
import { MainNav } from "./main-nav";

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

        <div className="relative ml-2 hidden max-w-sm flex-1 lg:block">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            disabled
            placeholder="사업·업무·회의록 검색 (Phase 8 예정)"
            className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-bg pr-3 pl-9 text-sm placeholder:text-muted"
            aria-label="전역 검색 (Phase 8 예정)"
          />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {isLeader(user) ? (
            <span className="hidden rounded-lg border border-border px-2.5 py-1 text-xs text-muted sm:inline" title="AI 제안 검토 화면은 Phase 5에서 제공됩니다">
              검토 대기 <strong className="tabular text-text">{pending}</strong>
            </span>
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
          <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg" aria-label={`읽지 않은 알림 ${unread}건`} title="알림 목록은 Phase 8에서 제공됩니다">
            <Bell className="h-5 w-5" />
            {unread > 0 ? (
              <span className="tabular absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold text-white">{unread}</span>
            ) : null}
          </span>
          <UserMenu name={user.displayName} subtitle={subtitle} canManageMembers={can(user, { type: "members.manage" })} />
        </div>
      </div>
    </header>
  );
}
